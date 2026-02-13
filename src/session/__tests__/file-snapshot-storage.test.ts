import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { FileSnapshotStorage } from '../file-snapshot-storage.js'
import { SessionError } from '../../errors.js'
import {
  createTestSnapshot,
  createTestManifest,
  createTestScope,
  createTestSnapshots,
} from '../../__fixtures__/mock-storage-provider.js'

describe('FileSnapshotStorage', () => {
  let storage: FileSnapshotStorage
  let testDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `file-storage-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await fs.mkdir(testDir, { recursive: true })
    storage = new FileSnapshotStorage(testDir)
  })

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('constructor', () => {
    describe('FileSnapshotStorage_When_ValidBaseDir_Then_CreatesInstance', () => {
      it('creates instance with valid base directory', () => {
        const baseDir = '/test/path'
        const instance = new FileSnapshotStorage(baseDir)
        expect(instance).toBeInstanceOf(FileSnapshotStorage)
      })
    })
  })

  describe('saveSnapshot', () => {
    describe('FileSnapshotStorage_When_saveSnapshot_Then_CreatesFiles', () => {
      it('saves snapshot to history file', async () => {
        const sessionId = 'test-session'
        const scope = createTestScope()
        const snapshot = createTestSnapshot({ sessionId, scope, snapshotId: 1 })

        await storage.saveSnapshot(sessionId, scope, false, snapshot)

        const historyPath = join(
          testDir,
          sessionId,
          'scopes',
          'agent',
          'test-id',
          'snapshots',
          'immutable_history',
          'snapshot_00001.json'
        )
        const content = await fs.readFile(historyPath, 'utf8')
        expect(JSON.parse(content)).toEqual(snapshot)
      })

      it('saves snapshot as latest when isLatest is true', async () => {
        const sessionId = 'test-session'
        const scope = createTestScope()
        const snapshot = createTestSnapshot({ sessionId, scope, snapshotId: 1 })

        await storage.saveSnapshot(sessionId, scope, true, snapshot)

        const latestPath = join(testDir, sessionId, 'scopes', 'agent', 'test-id', 'snapshots', 'snapshot_latest.json')
        const content = await fs.readFile(latestPath, 'utf8')
        expect(JSON.parse(content)).toEqual(snapshot)
      })

      it('creates directories recursively', async () => {
        const sessionId = 'new-session'
        const scope = createTestScope('agent', 'new-agent')
        const snapshot = createTestSnapshot({ sessionId, scope, snapshotId: 1 })

        await storage.saveSnapshot(sessionId, scope, true, snapshot)

        const expectedDir = join(testDir, sessionId, 'scopes', 'agent', 'new-agent', 'snapshots')
        const stats = await fs.stat(expectedDir)
        expect(stats.isDirectory()).toBe(true)
      })
    })

    describe('FileSnapshotStorage_When_saveSnapshotFails_Then_ThrowsSessionError', () => {
      it('throws SessionError when write fails', async () => {
        const sessionId = 'test-session'
        const scope = createTestScope()
        const snapshot = createTestSnapshot({ sessionId, scope, snapshotId: 1 })

        vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('Write failed'))

        await expect(storage.saveSnapshot(sessionId, scope, false, snapshot)).rejects.toThrow(SessionError)
      })
    })

    describe('FileSnapshotStorage_When_MultiAgentScope_Then_SavesCorrectly', () => {
      it('saves multi-agent snapshot to correct path', async () => {
        const sessionId = 'multi-session'
        const scope = createTestScope('multiAgent', 'graph-1')
        const snapshot = createTestSnapshot({ sessionId, scope, snapshotId: 1 })

        await storage.saveSnapshot(sessionId, scope, true, snapshot)

        const expectedPath = join(
          testDir,
          sessionId,
          'scopes',
          'multiAgent',
          'graph-1',
          'snapshots',
          'snapshot_latest.json'
        )
        const content = await fs.readFile(expectedPath, 'utf8')
        expect(JSON.parse(content)).toEqual(snapshot)
      })
    })
  })

  describe('loadSnapshot', () => {
    describe('FileSnapshotStorage_When_LoadLatestSnapshot_Then_ReturnsSnapshot', () => {
      it('loads latest snapshot when snapshotId is null', async () => {
        const sessionId = 'test-session'
        const scope = createTestScope()
        const snapshot = createTestSnapshot({ sessionId, scope, snapshotId: 1 })
        await storage.saveSnapshot(sessionId, scope, true, snapshot)

        const result = await storage.loadSnapshot(sessionId, scope, null)

        expect(result).toEqual(snapshot)
      })
    })

    describe('FileSnapshotStorage_When_LoadSpecificSnapshot_Then_ReturnsSnapshot', () => {
      it('loads specific snapshot by ID', async () => {
        const sessionId = 'test-session'
        const scope = createTestScope()
        const snapshot = createTestSnapshot({ sessionId, scope, snapshotId: 5 })
        await storage.saveSnapshot(sessionId, scope, false, snapshot)

        const result = await storage.loadSnapshot(sessionId, scope, 5)

        expect(result).toEqual(snapshot)
      })
    })

    describe('FileSnapshotStorage_When_SnapshotNotFound_Then_ReturnsNull', () => {
      it('returns null when snapshot file does not exist', async () => {
        const sessionId = 'nonexistent-session'
        const scope = createTestScope()

        const result = await storage.loadSnapshot(sessionId, scope, null)

        expect(result).toBeNull()
      })
    })

    describe('FileSnapshotStorage_When_InvalidJSON_Then_ThrowsSessionError', () => {
      it('throws SessionError when JSON is invalid', async () => {
        const sessionId = 'test-session'
        const scope = createTestScope()
        const filePath = join(testDir, sessionId, 'scopes', 'agent', 'test-id', 'snapshots', 'snapshot_latest.json')

        await fs.mkdir(join(testDir, sessionId, 'scopes', 'agent', 'test-id', 'snapshots'), { recursive: true })
        await fs.writeFile(filePath, 'invalid json', 'utf8')

        await expect(storage.loadSnapshot(sessionId, scope, null)).rejects.toThrow(SessionError)
      })
    })

    describe('FileSnapshotStorage_When_ReadError_Then_ThrowsSessionError', () => {
      it('throws SessionError when file read fails', async () => {
        const sessionId = 'test-session'
        const scope = createTestScope()

        vi.spyOn(fs, 'readFile').mockRejectedValueOnce(new Error('Permission denied'))

        await expect(storage.loadSnapshot(sessionId, scope, null)).rejects.toThrow(SessionError)
      })
    })
  })

  describe('listSnapshot', () => {
    describe('FileSnapshotStorage_When_listSnapshots_Then_ReturnsOrderedIds', () => {
      it('returns sorted snapshot IDs', async () => {
        const sessionId = 'test-session'
        const scope = createTestScope()
        const snapshots = createTestSnapshots(3, { sessionId, scope })

        await storage.saveSnapshot(sessionId, scope, false, snapshots[2]!)
        await storage.saveSnapshot(sessionId, scope, false, snapshots[0]!)
        await storage.saveSnapshot(sessionId, scope, false, snapshots[1]!)

        const result = await storage.listSnapshot(sessionId, scope)

        expect(result).toEqual([1, 2, 3])
      })

      it('returns empty array when no snapshots exist', async () => {
        const sessionId = 'empty-session'
        const scope = createTestScope()

        const result = await storage.listSnapshot(sessionId, scope)

        expect(result).toEqual([])
      })

      it('ignores non-snapshot files', async () => {
        const sessionId = 'test-session'
        const scope = createTestScope()
        const snapshot = createTestSnapshot({ sessionId, scope, snapshotId: 1 })
        await storage.saveSnapshot(sessionId, scope, false, snapshot)

        const historyDir = join(testDir, sessionId, 'scopes', 'agent', 'test-id', 'snapshots', 'immutable_history')
        await fs.writeFile(join(historyDir, 'other-file.txt'), 'not a snapshot', 'utf8')

        const result = await storage.listSnapshot(sessionId, scope)

        expect(result).toEqual([1])
      })
    })

    describe('FileSnapshotStorage_When_DirectoryNotFound_Then_ReturnsEmptyArray', () => {
      it('returns empty array when directory does not exist', async () => {
        const sessionId = 'nonexistent-session'
        const scope = createTestScope()

        const result = await storage.listSnapshot(sessionId, scope)

        expect(result).toEqual([])
      })
    })

    describe('FileSnapshotStorage_When_ReadDirFails_Then_ThrowsSessionError', () => {
      it('throws SessionError when readdir fails with non-ENOENT error', async () => {
        const sessionId = 'test-session'
        const scope = createTestScope()

        vi.spyOn(fs, 'readdir').mockRejectedValueOnce(new Error('Permission denied'))

        await expect(storage.listSnapshot(sessionId, scope)).rejects.toThrow(SessionError)
      })
    })
  })

  describe('saveManifest', () => {
    describe('FileSnapshotStorage_When_SaveManifest_Then_CreatesFile', () => {
      it('saves manifest to correct path', async () => {
        const sessionId = 'test-session'
        const scope = createTestScope()
        const manifest = createTestManifest()

        await storage.saveManifest({ sessionId, scope, manifest })

        const manifestPath = join(testDir, sessionId, 'scopes', 'agent', 'test-id', 'snapshots', 'manifest.json')
        const content = await fs.readFile(manifestPath, 'utf8')
        expect(JSON.parse(content)).toEqual(manifest)
      })
    })

    describe('FileSnapshotStorage_When_SaveManifestFails_Then_ThrowsSessionError', () => {
      it('throws SessionError when write fails', async () => {
        const sessionId = 'test-session'
        const scope = createTestScope()
        const manifest = createTestManifest()

        vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('Write failed'))

        await expect(storage.saveManifest({ sessionId, scope, manifest })).rejects.toThrow(SessionError)
      })
    })
  })

  describe('loadManifest', () => {
    describe('FileSnapshotStorage_When_LoadManifest_Then_ReturnsManifest', () => {
      it('loads manifest from file', async () => {
        const sessionId = 'test-session'
        const scope = createTestScope()
        const manifest = createTestManifest()
        await storage.saveManifest({ sessionId, scope, manifest })

        const result = await storage.loadManifest({ sessionId, scope })

        expect(result).toEqual(manifest)
      })
    })

    describe('FileSnapshotStorage_When_ManifestNotFound_Then_ReturnsDefault', () => {
      it('returns default manifest when manifest file does not exist', async () => {
        const sessionId = 'nonexistent-session'
        const scope = createTestScope()

        const result = await storage.loadManifest({ sessionId, scope })

        expect(result).toEqual({
          schemaVersion: 1,
          nextSnapshotId: 1,
          updatedAt: expect.any(String),
        })
      })
    })

    describe('FileSnapshotStorage_When_InvalidManifestJSON_Then_ThrowsSessionError', () => {
      it('throws SessionError when JSON is invalid', async () => {
        const sessionId = 'test-session'
        const scope = createTestScope()
        const filePath = join(testDir, sessionId, 'scopes', 'agent', 'test-id', 'snapshots', 'manifest.json')

        await fs.mkdir(join(testDir, sessionId, 'scopes', 'agent', 'test-id', 'snapshots'), { recursive: true })
        await fs.writeFile(filePath, 'invalid json', 'utf8')

        await expect(storage.loadManifest({ sessionId, scope })).rejects.toThrow(SessionError)
      })
    })
  })
})
