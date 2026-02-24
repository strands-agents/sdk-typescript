/**
 * Integration tests for session management.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { inject } from 'vitest'
import { Agent } from '$/sdk/agent/agent.js'
import { S3Client, CreateBucketCommand, DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts'
import { SessionManager } from '$/sdk/session/session-manager.js'
import { FileStorage } from '$/sdk/session/file-storage.js'
import { S3Storage } from '$/sdk/session/s3-storage.js'
import { bedrock } from './__fixtures__/model-providers.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const AWS_REGION = process.env.AWS_REGION ?? 'us-east-1'

async function getBucketName(credentials: any): Promise<string> {
  const sts = new STSClient({ region: AWS_REGION, credentials })
  const { Account } = await sts.send(new GetCallerIdentityCommand({}))
  return `test-strands-session-bucket-${Account}-${AWS_REGION}`
}

function makeFileManager(sessionId: string, storageDir: string): SessionManager {
  return new SessionManager({ sessionId, storage: { snapshot: new FileStorage(storageDir) } })
}

function makeS3Manager(sessionId: string, bucket: string, credentials: any): SessionManager {
  return new SessionManager({
    sessionId,
    storage: { snapshot: new S3Storage({ bucket, s3Client: new S3Client({ region: AWS_REGION, credentials }) }) },
  })
}

async function getPersistedMessageCount(manager: SessionManager): Promise<number> {
  const snap = await (manager as any)._storage.snapshot.loadSnapshot({
    location: (manager as any)._location,
  })
  return (snap?.data?.messages as unknown[])?.length ?? 0
}

// ─── File Storage Tests ───────────────────────────────────────────────────────

describe.skipIf(bedrock.skip)('Session Management - FileStorage', () => {
  let tempDir: string

  beforeAll(async () => {
    tempDir = join(tmpdir(), `strands-session-integ-${Date.now()}`)
    await fs.mkdir(tempDir, { recursive: true })
  })

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('persists and restores agent messages across sessions', async () => {
    const sessionId = randomUUID()
    const model = bedrock.createModel()

    const manager1 = makeFileManager(sessionId, tempDir)
    const agent1 = new Agent({ model, sessionManager: manager1, printer: false })
    await agent1.invoke('Hello!')
    expect(agent1.messages).toHaveLength(2)
    expect(await getPersistedMessageCount(manager1)).toBe(2)

    const manager2 = makeFileManager(sessionId, tempDir)
    const agent2 = new Agent({ model, sessionManager: manager2, printer: false })
    await agent2.initialize()
    expect(agent2.messages).toHaveLength(2)

    await agent2.invoke('Hello again!')
    expect(agent2.messages).toHaveLength(4)
    expect(await getPersistedMessageCount(manager2)).toBe(4)
  })

  it('preserves conversation context across sessions', async () => {
    const sessionId = randomUUID()
    const model = bedrock.createModel()

    const manager1 = makeFileManager(sessionId, tempDir)
    const agent1 = new Agent({ model, sessionManager: manager1, printer: false })
    await agent1.invoke('My name is Alice')
    await agent1.invoke('What is my name?')
    expect(agent1.messages).toHaveLength(4)

    const manager2 = makeFileManager(sessionId, tempDir)
    const agent2 = new Agent({ model, sessionManager: manager2, printer: false })
    await agent2.initialize()
    expect(agent2.messages).toHaveLength(4)

    const result = await agent2.invoke('Repeat my name')
    const text = result.lastMessage.content.find((b) => b.type === 'textBlock')
    expect(text?.text).toMatch(/Alice/i)
  })

  it('creates immutable snapshots and restores from specific snapshot', async () => {
    const sessionId = randomUUID()
    const model = bedrock.createModel()

    const manager1 = new SessionManager({
      sessionId,
      storage: { snapshot: new FileStorage(tempDir) },
      snapshotTrigger: () => true,
    })
    const agent1 = new Agent({ model, sessionManager: manager1, printer: false })
    await agent1.invoke('First message') // snapshot 1: 2 messages
    await agent1.invoke('Second message') // snapshot 2: 4 messages
    expect(agent1.messages).toHaveLength(4)

    // Restore from snapshot 1 — should only have 2 messages
    const manager2 = new SessionManager({
      sessionId,
      storage: { snapshot: new FileStorage(tempDir) },
      loadSnapshotId: '1',
    })
    const agent2 = new Agent({ model, sessionManager: manager2, printer: false })
    await agent2.initialize()
    expect(agent2.messages).toHaveLength(2)
  })

  it('verifies storage layout: snapshot_latest, manifest, and immutable_history', async () => {
    const sessionId = randomUUID()
    const model = bedrock.createModel()

    const manager = new SessionManager({
      sessionId,
      storage: { snapshot: new FileStorage(tempDir) },
      snapshotTrigger: () => true,
    })
    const agent = new Agent({ model, sessionManager: manager, printer: false })
    await agent.invoke('Hello!')

    const base = join(tempDir, sessionId, 'scopes', 'agent', 'default', 'snapshots')
    await expect(fs.access(join(base, 'snapshot_latest.json'))).resolves.toBeUndefined()
    await expect(fs.access(join(base, 'manifest.json'))).resolves.toBeUndefined()
    await expect(fs.access(join(base, 'immutable_history', 'snapshot_00001.json'))).resolves.toBeUndefined()
  })
})

// ─── S3 Storage Tests ─────────────────────────────────────────────────────────

describe.skipIf(bedrock.skip)('Session Management - S3Storage', () => {
  let bucket: string
  let credentials: any
  let s3: S3Client
  const sessionIds: string[] = []

  beforeAll(async () => {
    credentials = inject('provider-bedrock')?.credentials
    bucket = await getBucketName(credentials)
    s3 = new S3Client({ region: AWS_REGION, credentials })
    try {
      await s3.send(
        new CreateBucketCommand({
          Bucket: bucket,
          ...(AWS_REGION !== 'us-east-1' && { CreateBucketConfiguration: { LocationConstraint: AWS_REGION as any } }),
        })
      )
    } catch (e: any) {
      if (e?.name !== 'BucketAlreadyOwnedByYou') throw e
    }
  })

  afterAll(async () => {
    if (!sessionIds.length) return
    for (const sessionId of sessionIds) {
      let token: string | undefined
      do {
        const list = await s3.send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: `${sessionId}/`, ContinuationToken: token })
        )
        const objects = list.Contents?.map((o) => ({ Key: o.Key! })) ?? []
        if (objects.length) await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects } }))
        token = list.NextContinuationToken
      } while (token)
    }
  })

  it('persists and restores agent messages across sessions', async () => {
    const sessionId = randomUUID()
    sessionIds.push(sessionId)
    const model = bedrock.createModel()

    const manager1 = makeS3Manager(sessionId, bucket, credentials)
    const agent1 = new Agent({ model, sessionManager: manager1, printer: false })
    await agent1.invoke('Hello!')
    expect(agent1.messages).toHaveLength(2)
    expect(await getPersistedMessageCount(manager1)).toBe(2)

    const manager2 = makeS3Manager(sessionId, bucket, credentials)
    const agent2 = new Agent({ model, sessionManager: manager2, printer: false })
    await agent2.initialize()
    expect(agent2.messages).toHaveLength(2)

    await agent2.invoke('Hello again!')
    expect(agent2.messages).toHaveLength(4)
    expect(await getPersistedMessageCount(manager2)).toBe(4)
  })

  it('preserves conversation context across sessions', async () => {
    const sessionId = randomUUID()
    sessionIds.push(sessionId)
    const model = bedrock.createModel()

    const manager1 = makeS3Manager(sessionId, bucket, credentials)
    const agent1 = new Agent({ model, sessionManager: manager1, printer: false })
    await agent1.invoke('My name is Bob')
    await agent1.invoke('What is my name?')
    expect(agent1.messages).toHaveLength(4)

    const manager2 = makeS3Manager(sessionId, bucket, credentials)
    const agent2 = new Agent({ model, sessionManager: manager2, printer: false })
    await agent2.initialize()
    expect(agent2.messages).toHaveLength(4)

    const result = await agent2.invoke('Repeat my name')
    const text = result.lastMessage.content.find((b) => b.type === 'textBlock')
    expect(text?.text).toMatch(/Bob/i)
  })

  it('creates immutable snapshots and supports time-travel restore', async () => {
    const sessionId = randomUUID()
    sessionIds.push(sessionId)
    const model = bedrock.createModel()

    const manager1 = new SessionManager({
      sessionId,
      storage: { snapshot: new S3Storage({ bucket, s3Client: new S3Client({ region: AWS_REGION, credentials }) }) },
      snapshotTrigger: ({ turnCount }) => turnCount % 2 === 0,
      saveLatestOn: 'invocation',
    })
    const agent1 = new Agent({ model, sessionManager: manager1, printer: false })
    await agent1.invoke('What is 10 + 5?') // turn 1 — no snapshot
    await agent1.invoke('What is 20 * 3?') // turn 2 — snapshot 1
    await agent1.invoke('What is 100 / 4?') // turn 3 — no snapshot
    await agent1.invoke('What is 50 - 15?') // turn 4 — snapshot 2
    expect(agent1.messages).toHaveLength(8)

    // Restore from snapshot 1 (after turn 2) — should have 4 messages
    const manager2 = new SessionManager({
      sessionId,
      storage: { snapshot: new S3Storage({ bucket, s3Client: new S3Client({ region: AWS_REGION, credentials }) }) },
      loadSnapshotId: '1',
      saveLatestOn: 'never',
    })
    const agent2 = new Agent({ model, sessionManager: manager2, printer: false })
    await agent2.initialize()
    expect(agent2.messages).toHaveLength(4)

    const result = await agent2.invoke('What was my last question?')
    const text = result.lastMessage.content.find((b) => b.type === 'textBlock')
    expect(text?.text).toMatch(/20.*3|multiply|60/i)
  })
})
