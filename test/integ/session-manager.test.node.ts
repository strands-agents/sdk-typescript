/**
 * Integration tests for session management.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { inject } from 'vitest'
import { v7 as uuidv7 } from 'uuid'
import { Agent } from '$/sdk/agent/agent.js'
import {
  S3Client,
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'
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
    location: (manager as any)._location({ agentId: 'default' }),
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
    const sessionId = uuidv7()
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
    const sessionId = uuidv7()
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

  it('creates immutable snapshots, verifies storage layout, and restores from specific snapshot', async () => {
    const sessionId = uuidv7()
    const model = bedrock.createModel()
    const storage = new FileStorage(tempDir)

    const manager1 = new SessionManager({ sessionId, storage: { snapshot: storage }, snapshotTrigger: () => true })
    const agent1 = new Agent({ model, sessionManager: manager1, printer: false })
    await agent1.invoke('First message') // snapshot 1: 2 messages
    await agent1.invoke('Second message') // snapshot 2: 4 messages
    expect(agent1.messages).toHaveLength(4)

    // Verify storage layout
    const base = join(tempDir, sessionId, 'scopes', 'agent', 'default', 'snapshots')
    await expect(fs.access(join(base, 'snapshot_latest.json'))).resolves.toBeUndefined()
    const files = await fs.readdir(join(base, 'immutable_history'))
    expect(files).toHaveLength(2)
    expect(files.every((f) => /^snapshot_[\w-]+\.json$/.test(f))).toBe(true)

    // Restore from snapshot 1 — should only have 2 messages
    const snapshotIds = await storage.listSnapshotIds({ location: { sessionId, scope: 'agent', scopeId: 'default' } })
    expect(snapshotIds[0]).toBeDefined()
    const agent2 = new Agent({
      model,
      sessionManager: new SessionManager({
        sessionId,
        storage: { snapshot: storage },
        loadSnapshotId: snapshotIds[0]!,
      }),
      printer: false,
    })
    await agent2.initialize()
    expect(agent2.messages).toHaveLength(2)
  })
})

// ─── S3 Storage Tests ─────────────────────────────────────────────────────────

describe.skipIf(bedrock.skip)('Session Management - S3Storage', () => {
  let bucket: string
  let credentials: any
  let s3: S3Client

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
    // Delete all objects then the bucket
    let token: string | undefined
    do {
      const list = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }))
      const objects = list.Contents?.map((o) => ({ Key: o.Key! })) ?? []
      if (objects.length) await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects } }))
      token = list.NextContinuationToken
    } while (token)
    await s3.send(new DeleteBucketCommand({ Bucket: bucket }))
  })

  it('persists and restores agent messages across sessions', async () => {
    const sessionId = uuidv7()
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
    const sessionId = uuidv7()
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
    const sessionId = uuidv7()
    const model = bedrock.createModel()

    const manager1 = new SessionManager({
      sessionId,
      storage: { snapshot: new S3Storage({ bucket, s3Client: new S3Client({ region: AWS_REGION, credentials }) }) },
      snapshotTrigger: ({ agentData }) => agentData.messages.length === 4,
      saveLatestOn: 'invocation',
    })
    const agent1 = new Agent({ model, sessionManager: manager1, printer: false })
    await agent1.invoke('What is 10 + 5?') // 2 messages — no snapshot
    await agent1.invoke('What is 20 * 3?') // 4 messages — snapshot 1
    await agent1.invoke('What is 100 / 4?') // 6 messages — no snapshot
    await agent1.invoke('What is 50 - 15?') // 8 messages — no snapshot
    expect(agent1.messages).toHaveLength(8)

    // Verify UUID-based S3 key naming and restore from snapshot 1 (after turn 2)
    const s3Storage = new S3Storage({ bucket, s3Client: new S3Client({ region: AWS_REGION, credentials }) })
    const snapshotIds = await s3Storage.listSnapshotIds({ location: { sessionId, scope: 'agent', scopeId: 'default' } })
    expect(snapshotIds).toHaveLength(1)
    expect(snapshotIds.every((id) => /^[\w-]{36}$/.test(id))).toBe(true)
    expect(snapshotIds[0]).toBeDefined()
    const manager2 = new SessionManager({
      sessionId,
      storage: { snapshot: s3Storage },
      loadSnapshotId: snapshotIds[0]!,
      saveLatestOn: 'trigger',
    })
    const agent2 = new Agent({ model, sessionManager: manager2, printer: false })
    await agent2.initialize()
    expect(agent2.messages).toHaveLength(4)

    const result = await agent2.invoke('What was my last question?')
    const text = result.lastMessage.content.find((b) => b.type === 'textBlock')
    expect(text?.text).toMatch(/20.*3|multiply|60/i)
  })
})
