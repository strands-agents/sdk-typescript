import { describe, expect, it, beforeEach, vi, type MockedFunction } from 'vitest'
import { S3Storage } from '../s3-storage.js'
import { SessionError } from '../../errors.js'
import { createTestSnapshot, createTestManifest, createTestScope } from '../../__fixtures__/mock-storage-provider.js'

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(function () {
    return {
      send: vi.fn(),
      config: {},
    }
  }),
  PutObjectCommand: vi.fn().mockImplementation(function (input) {
    return { input }
  }),
  GetObjectCommand: vi.fn().mockImplementation(function (input) {
    return { input }
  }),
  ListObjectsV2Command: vi.fn().mockImplementation(function (input) {
    return { input }
  }),
}))

describe('S3Storage', () => {
  let storage: S3Storage
  let mockS3Client: { send: MockedFunction<any> }

  beforeEach(() => {
    vi.clearAllMocks()

    storage = new S3Storage({
      bucket: 'test-bucket',
      region: 'us-east-1',
    })

    mockS3Client = (storage as any)._s3
  })

  describe('constructor', () => {
    describe('S3SnapshotStorage_When_ValidConfig_Then_CreatesInstance', () => {
      it('stores bucket and region configuration', () => {
        const config = { bucket: 'test-bucket', region: 'us-west-2' }
        const instance = new S3Storage(config)
        expect((instance as any)._bucket).toBe('test-bucket')
        expect((instance as any)._s3).toBeDefined()
      })

      it('stores prefix when provided', () => {
        const config = { bucket: 'test-bucket', prefix: 'my-prefix', region: 'us-east-1' }
        const instance = new S3Storage(config)
        expect((instance as any)._prefix).toBe('my-prefix')
      })

      it('uses provided S3 client instead of creating new one', () => {
        const customClient = { send: vi.fn() }
        const config = { bucket: 'test-bucket', s3Client: customClient as any }
        const instance = new S3Storage(config)
        expect((instance as any)._s3).toBe(customClient)
      })

      it('throws error when both s3Client and region are provided', () => {
        const customClient = { send: vi.fn() }
        const config = {
          bucket: 'test-bucket',
          region: 'us-west-2',
          s3Client: customClient as any,
        }
        expect(() => new S3Storage(config)).toThrow(SessionError)
        expect(() => new S3Storage(config)).toThrow('Cannot specify both s3Client and region')
      })
    })
  })

  describe('saveSnapshot', () => {
    describe('S3SnapshotStorage_When_saveSnapshot_Then_PutsObjects', () => {
      it('saves snapshot to S3 history', async () => {
        const sessionId = 'test-session'
        const scope = createTestScope()
        const snapshot = createTestSnapshot({ snapshotId: '1' })
        mockS3Client.send.mockResolvedValue({})

        await storage.saveSnapshot({ sessionId, scope, isLatest: false, snapshot })

        expect(mockS3Client.send).toHaveBeenCalledWith(
          expect.objectContaining({
            input: {
              Bucket: 'test-bucket',
              Key: 'test-session/scopes/agent/test-id/snapshots/immutable_history/snapshot_00001.json',
              Body: JSON.stringify(snapshot, null, 2),
              ContentType: 'application/json',
            },
          })
        )
      })

      it('saves snapshot as latest when isLatest is true', async () => {
        const sessionId = 'test-session'
        const scope = createTestScope()
        const snapshot = createTestSnapshot({ snapshotId: '1' })
        mockS3Client.send.mockResolvedValue({})

        await storage.saveSnapshot({ sessionId, scope, isLatest: true, snapshot })

        expect(mockS3Client.send).toHaveBeenCalledTimes(2)
        expect(mockS3Client.send).toHaveBeenCalledWith(
          expect.objectContaining({
            input: expect.objectContaining({
              Key: 'test-session/scopes/agent/test-id/snapshots/snapshot_latest.json',
            }),
          })
        )
      })

      it('uses prefix when configured', async () => {
        const storageWithPrefix = new S3Storage({
          bucket: 'test-bucket',
          prefix: 'my-app',
          region: 'us-east-1',
        })
        const mockPrefixS3Client = (storageWithPrefix as any)._s3
        const sessionId = 'test-session'
        const scope = createTestScope()
        const snapshot = createTestSnapshot({ snapshotId: '1' })
        mockPrefixS3Client.send.mockResolvedValue({})

        await storageWithPrefix.saveSnapshot({ sessionId, scope, isLatest: false, snapshot })

        expect(mockPrefixS3Client.send).toHaveBeenCalledWith(
          expect.objectContaining({
            input: expect.objectContaining({
              Key: 'my-app/test-session/scopes/agent/test-id/snapshots/immutable_history/snapshot_00001.json',
            }),
          })
        )
      })
    })

    describe('S3SnapshotStorage_When_saveSnapshotFails_Then_ThrowsSessionError', () => {
      it('throws SessionError when S3 put fails', async () => {
        const sessionId = 'test-session'
        const scope = createTestScope()
        const snapshot = createTestSnapshot({ snapshotId: '1' })
        mockS3Client.send.mockRejectedValue(new Error('S3 error'))

        await expect(storage.saveSnapshot({ sessionId, scope, isLatest: false, snapshot })).rejects.toThrow(
          SessionError
        )
        await expect(storage.saveSnapshot({ sessionId, scope, isLatest: false, snapshot })).rejects.toThrow(
          'Failed to write S3 object'
        )
      })
    })

    describe('S3SnapshotStorage_When_MultiAgentScope_Then_SavesCorrectly', () => {
      it('saves multi-agent snapshot to correct S3 key', async () => {
        const sessionId = 'multi-session'
        const scope = createTestScope('multiAgent', 'graph-1')
        const snapshot = createTestSnapshot({ snapshotId: '1' })
        mockS3Client.send.mockResolvedValue({})

        await storage.saveSnapshot({ sessionId, scope, isLatest: true, snapshot })

        expect(mockS3Client.send).toHaveBeenCalledWith(
          expect.objectContaining({
            input: expect.objectContaining({
              Key: 'multi-session/scopes/multiAgent/graph-1/snapshots/snapshot_latest.json',
            }),
          })
        )
      })
    })
  })

  describe('loadSnapshot', () => {
    describe('S3SnapshotStorage_When_LoadLatestSnapshot_Then_ReturnsSnapshot', () => {
      it('loads latest snapshot when snapshotId is null', async () => {
        const sessionId = 'test-session'
        const scope = createTestScope()
        const snapshot = createTestSnapshot({ snapshotId: '1' })
        mockS3Client.send.mockResolvedValue({
          Body: { transformToString: () => Promise.resolve(JSON.stringify(snapshot)) },
        })

        const result = await storage.loadSnapshot({ sessionId, scope })

        expect(result).toEqual(snapshot)
        expect(mockS3Client.send).toHaveBeenCalledWith(
          expect.objectContaining({
            input: {
              Bucket: 'test-bucket',
              Key: 'test-session/scopes/agent/test-id/snapshots/snapshot_latest.json',
            },
          })
        )
      })
    })

    describe('S3SnapshotStorage_When_LoadSpecificSnapshot_Then_ReturnsSnapshot', () => {
      it('loads specific snapshot by ID', async () => {
        const sessionId = 'test-session'
        const scope = createTestScope()
        const snapshot = createTestSnapshot({ snapshotId: '5' })
        mockS3Client.send.mockResolvedValue({
          Body: { transformToString: () => Promise.resolve(JSON.stringify(snapshot)) },
        })

        const result = await storage.loadSnapshot({ sessionId, scope, snapshotId: '5' })

        expect(result).toEqual(snapshot)
        expect(mockS3Client.send).toHaveBeenCalledWith(
          expect.objectContaining({
            input: expect.objectContaining({
              Key: 'test-session/scopes/agent/test-id/snapshots/immutable_history/snapshot_00005.json',
            }),
          })
        )
      })
    })

    describe('S3SnapshotStorage_When_SnapshotNotFound_Then_ReturnsNull', () => {
      it('returns null when S3 object does not exist', async () => {
        const sessionId = 'nonexistent-session'
        const scope = createTestScope()
        const noSuchKeyError = new Error('NoSuchKey')
        noSuchKeyError.name = 'NoSuchKey'
        mockS3Client.send.mockRejectedValue(noSuchKeyError)

        const result = await storage.loadSnapshot({ sessionId, scope })

        expect(result).toBeNull()
      })

      it('returns null when S3 response has no body', async () => {
        const sessionId = 'test-session'
        const scope = createTestScope()
        mockS3Client.send.mockResolvedValue({ Body: null })

        const result = await storage.loadSnapshot({ sessionId, scope })

        expect(result).toBeNull()
      })

      it('returns null when S3 response body is empty', async () => {
        const sessionId = 'test-session'
        const scope = createTestScope()
        mockS3Client.send.mockResolvedValue({
          Body: { transformToString: () => Promise.resolve('') },
        })

        const result = await storage.loadSnapshot({ sessionId, scope })

        expect(result).toBeNull()
      })
    })

    describe('S3SnapshotStorage_When_InvalidJSON_Then_ThrowsSessionError', () => {
      it('throws SessionError when JSON is invalid', async () => {
        const sessionId = 'test-session'
        const scope = createTestScope()
        mockS3Client.send.mockResolvedValue({
          Body: { transformToString: () => Promise.resolve('invalid json') },
        })

        await expect(storage.loadSnapshot({ sessionId, scope })).rejects.toThrow(SessionError)
        await expect(storage.loadSnapshot({ sessionId, scope })).rejects.toThrow('Invalid JSON in S3 object')
      })
    })

    describe('S3SnapshotStorage_When_S3Error_Then_ThrowsSessionError', () => {
      it('throws SessionError when S3 get fails', async () => {
        const sessionId = 'test-session'
        const scope = createTestScope()
        mockS3Client.send.mockRejectedValue(new Error('S3 error'))

        await expect(storage.loadSnapshot({ sessionId, scope })).rejects.toThrow(SessionError)
        await expect(storage.loadSnapshot({ sessionId, scope })).rejects.toThrow('S3 error reading')
      })
    })
  })

  describe('listSnapshots', () => {
    describe('S3SnapshotStorage_When_listSnapshots_Then_ReturnsOrderedIds', () => {
      it('returns sorted snapshot IDs', async () => {
        const sessionId = 'test-session'
        const scope = createTestScope()
        mockS3Client.send.mockResolvedValue({
          Contents: [
            { Key: 'test-session/scopes/agent/test-id/snapshots/immutable_history/snapshot_00003.json' },
            { Key: 'test-session/scopes/agent/test-id/snapshots/immutable_history/snapshot_00001.json' },
            { Key: 'test-session/scopes/agent/test-id/snapshots/immutable_history/snapshot_00002.json' },
          ],
        })

        const result = await storage.listSnapshotIds({ sessionId, scope })

        expect(result).toEqual(['1', '2', '3'])
        expect(mockS3Client.send).toHaveBeenCalledWith(
          expect.objectContaining({
            input: {
              Bucket: 'test-bucket',
              Prefix: 'test-session/scopes/agent/test-id/snapshots/immutable_history/',
            },
          })
        )
      })

      it('returns empty array when no objects exist', async () => {
        const sessionId = 'empty-session'
        const scope = createTestScope()
        mockS3Client.send.mockResolvedValue({ Contents: [] })

        const result = await storage.listSnapshotIds({ sessionId, scope })

        expect(result).toEqual([])
      })

      it('ignores non-snapshot objects', async () => {
        const sessionId = 'test-session'
        const scope = createTestScope()
        mockS3Client.send.mockResolvedValue({
          Contents: [
            { Key: 'test-session/scopes/agent/test-id/snapshots/immutable_history/snapshot_00001.json' },
            { Key: 'test-session/scopes/agent/test-id/snapshots/immutable_history/other-file.txt' },
            { Key: 'test-session/scopes/agent/test-id/snapshots/immutable_history/snapshot_00002.json' },
          ],
        })

        const result = await storage.listSnapshotIds({ sessionId, scope })

        expect(result).toEqual(['1', '2'])
      })

      it('handles objects without Key property', async () => {
        const sessionId = 'test-session'
        const scope = createTestScope()
        mockS3Client.send.mockResolvedValue({
          Contents: [
            { Key: 'test-session/scopes/agent/test-id/snapshots/immutable_history/snapshot_00001.json' },
            {},
            { Key: 'test-session/scopes/agent/test-id/snapshots/immutable_history/snapshot_00002.json' },
          ],
        })

        const result = await storage.listSnapshotIds({ sessionId, scope })

        expect(result).toEqual(['1', '2'])
      })
    })

    describe('S3SnapshotStorage_When_ListObjectsFails_Then_ThrowsSessionError', () => {
      it('throws SessionError when S3 list fails', async () => {
        const sessionId = 'test-session'
        const scope = createTestScope()
        mockS3Client.send.mockRejectedValue(new Error('S3 list error'))

        await expect(storage.listSnapshotIds({ sessionId, scope })).rejects.toThrow(SessionError)
        await expect(storage.listSnapshotIds({ sessionId, scope })).rejects.toThrow(
          'Failed to list snapshots for session test-session'
        )
      })
    })
  })

  describe('loadManifest', () => {
    describe('S3SnapshotStorage_When_LoadManifest_Then_ReturnsManifest', () => {
      it('loads existing manifest', async () => {
        const sessionId = 'test-session'
        const scope = createTestScope()
        const manifest = createTestManifest({ nextSnapshotId: '5' })
        mockS3Client.send.mockResolvedValue({
          Body: { transformToString: () => Promise.resolve(JSON.stringify(manifest)) },
        })

        const result = await storage.loadManifest({ sessionId, scope })

        expect(result).toEqual(manifest)
        expect(mockS3Client.send).toHaveBeenCalledWith(
          expect.objectContaining({
            input: expect.objectContaining({
              Key: 'test-session/scopes/agent/test-id/snapshots/manifest.json',
            }),
          })
        )
      })
    })

    describe('S3SnapshotStorage_When_ManifestNotFound_Then_ReturnsDefault', () => {
      it('returns default manifest when S3 object does not exist', async () => {
        const sessionId = 'nonexistent-session'
        const scope = createTestScope()
        const noSuchKeyError = new Error('NoSuchKey')
        noSuchKeyError.name = 'NoSuchKey'
        mockS3Client.send.mockRejectedValue(noSuchKeyError)

        const result = await storage.loadManifest({ sessionId, scope })

        expect(result).toEqual({
          schemaVersion: '1.0',
          nextSnapshotId: '1',
          updatedAt: expect.any(String),
        })
      })
    })

    describe('S3SnapshotStorage_When_InvalidManifestJSON_Then_ThrowsSessionError', () => {
      it('throws SessionError when manifest JSON is invalid', async () => {
        const sessionId = 'test-session'
        const scope = createTestScope()
        mockS3Client.send.mockResolvedValue({
          Body: { transformToString: () => Promise.resolve('invalid json') },
        })

        await expect(storage.loadManifest({ sessionId, scope })).rejects.toThrow(SessionError)
      })
    })
  })

  describe('saveManifest', () => {
    describe('S3SnapshotStorage_When_SaveManifest_Then_PutsObject', () => {
      it('saves manifest to S3', async () => {
        const sessionId = 'test-session'
        const scope = createTestScope()
        const manifest = createTestManifest({ nextSnapshotId: '10' })
        mockS3Client.send.mockResolvedValue({})

        await storage.saveManifest({ sessionId, scope, manifest })

        expect(mockS3Client.send).toHaveBeenCalledWith(
          expect.objectContaining({
            input: {
              Bucket: 'test-bucket',
              Key: 'test-session/scopes/agent/test-id/snapshots/manifest.json',
              Body: JSON.stringify(manifest, null, 2),
              ContentType: 'application/json',
            },
          })
        )
      })
    })

    describe('S3SnapshotStorage_When_SaveManifestFails_Then_ThrowsSessionError', () => {
      it('throws SessionError when S3 put fails', async () => {
        const sessionId = 'test-session'
        const scope = createTestScope()
        const manifest = createTestManifest()
        mockS3Client.send.mockRejectedValue(new Error('S3 error'))

        await expect(storage.saveManifest({ sessionId, scope, manifest })).rejects.toThrow(SessionError)
      })
    })
  })

  describe('edge cases', () => {
    describe('S3SnapshotStorage_When_InvalidIdentifiers_Then_ThrowsError', () => {
      it('throws error for invalid session ID', async () => {
        const invalidSessionId = 'invalid/session'
        const scope = createTestScope()
        const snapshot = createTestSnapshot({ snapshotId: '1' })

        await expect(
          storage.saveSnapshot({ sessionId: invalidSessionId, scope, isLatest: false, snapshot })
        ).rejects.toThrow()
      })

      it('throws error for invalid agent ID', async () => {
        const sessionId = 'test-session'
        const invalidScope = createTestScope('agent', 'invalid/agent')
        const snapshot = createTestSnapshot({ snapshotId: '1' })

        await expect(
          storage.saveSnapshot({ sessionId, scope: invalidScope, isLatest: false, snapshot })
        ).rejects.toThrow()
      })
    })

    describe('S3SnapshotStorage_When_LargeSnapshot_Then_HandlesCorrectly', () => {
      it('handles large snapshots', async () => {
        const sessionId = 'test-session'
        const scope = createTestScope()
        const largeState = { data: 'x'.repeat(10000) }
        const snapshot = createTestSnapshot({ snapshotId: '1', state: largeState })

        // Setup mocks for both save and load operations
        mockS3Client.send
          .mockResolvedValueOnce({}) // for saveSnapshot (history)
          .mockResolvedValueOnce({}) // for saveSnapshot (latest)
          .mockResolvedValueOnce({
            // for loadSnapshot
            Body: { transformToString: () => Promise.resolve(JSON.stringify(snapshot)) },
          })

        await storage.saveSnapshot({ sessionId, scope, isLatest: true, snapshot })
        const result = await storage.loadSnapshot({ sessionId, scope })

        expect(result?.state).toEqual(largeState)
      })
    })

    describe('S3SnapshotStorage_When_SpecialCharacters_Then_HandlesCorrectly', () => {
      it('handles special characters in snapshot data', async () => {
        const sessionId = 'test-session'
        const scope = createTestScope()
        const specialData = { emoji: '🚀', unicode: 'café', quotes: '"test"' }
        const snapshot = createTestSnapshot({ snapshotId: '1', state: specialData })

        // Setup mocks for both save and load operations
        mockS3Client.send
          .mockResolvedValueOnce({}) // for saveSnapshot (history)
          .mockResolvedValueOnce({}) // for saveSnapshot (latest)
          .mockResolvedValueOnce({
            // for loadSnapshot
            Body: { transformToString: () => Promise.resolve(JSON.stringify(snapshot)) },
          })

        await storage.saveSnapshot({ sessionId, scope, isLatest: true, snapshot })
        const result = await storage.loadSnapshot({ sessionId, scope })

        expect(result?.state).toEqual(specialData)
      })
    })
  })
})
