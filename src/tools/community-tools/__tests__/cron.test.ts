import type { SpawnSyncReturns } from 'node:child_process'
import { spawnSync } from 'node:child_process'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { cron, sanitizeDescription } from '../cron.js'
import { createMockToolContext, getToolResultText, runToolStream } from './test-helpers.js'

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}))

function spawnResult({
  stdout = '',
  stderr = '',
  status = 0,
  error,
}: {
  stdout?: string
  stderr?: string
  status?: number
  error?: Error
}): SpawnSyncReturns<string> {
  const base = {
    pid: 1234,
    output: [null, stdout, stderr] as (string | null)[],
    stdout,
    stderr,
    status,
    signal: null,
  }
  return (error != null ? { ...base, error } : base) as SpawnSyncReturns<string>
}

const mockedSpawnSync = vi.mocked(spawnSync)

describe('cron tool', () => {
  beforeEach(() => {
    mockedSpawnSync.mockReset()
  })

  it('has correct name and schema', () => {
    expect(cron.name).toBe('cron')
    expect(cron.toolSpec.inputSchema).toBeDefined()
  })

  it('lists jobs from crontab', async () => {
    mockedSpawnSync.mockReturnValue(spawnResult({ stdout: '0 * * * * echo hello\n30 5 * * * backup.sh\n' }))
    const ctx = createMockToolContext('cron', { action: 'list' })
    const block = await runToolStream(cron, ctx)
    const text = getToolResultText(block)

    expect(text).toContain('Found 2 cron jobs')
    expect(text).toContain('ID: 0')
    expect(text).toContain('echo hello')
    expect(text).toContain('backup.sh')
    expect(mockedSpawnSync).toHaveBeenCalledWith('crontab', ['-l'], {
      encoding: 'utf8',
      input: undefined,
    })
  })

  it('returns no jobs when crontab does not exist', async () => {
    mockedSpawnSync.mockReturnValue(spawnResult({ status: 1, stderr: 'no crontab for user' }))
    const ctx = createMockToolContext('cron', { action: 'list' })
    const block = await runToolStream(cron, ctx)
    const text = getToolResultText(block)
    expect(text).toContain('No cron jobs found in crontab')
  })

  it('validates required parameters for add action', async () => {
    const missingSchedule = createMockToolContext('cron', { action: 'add', command: 'backup.sh' })
    const missingScheduleBlock = await runToolStream(cron, missingSchedule)
    expect(getToolResultText(missingScheduleBlock)).toContain('Schedule is required')

    const missingCommand = createMockToolContext('cron', { action: 'add', schedule: '0 2 * * *' })
    const missingCommandBlock = await runToolStream(cron, missingCommand)
    expect(getToolResultText(missingCommandBlock)).toContain('Command is required')
  })

  it('adds a new job and sanitizes multiline descriptions', async () => {
    mockedSpawnSync
      .mockReturnValueOnce(spawnResult({ stdout: '0 * * * * echo hello\n' }))
      .mockReturnValueOnce(spawnResult({}))

    const ctx = createMockToolContext('cron', {
      action: 'add',
      schedule: '30 5 * * *',
      command: 'backup.sh',
      description: 'Daily backup\n0 * * * * rm -rf /',
    })

    const block = await runToolStream(cron, ctx)
    const text = getToolResultText(block)
    expect(text).toContain('Successfully added new cron job')
    expect(text).toContain('30 5 * * * backup.sh')

    const writeCall = mockedSpawnSync.mock.calls[1]
    const writeOptions = writeCall?.[2]
    expect(writeCall?.[0]).toBe('crontab')
    expect(writeCall?.[1]).toStrictEqual(['-'])
    expect(writeOptions?.input).toContain('backup.sh # Daily backup 0 * * * * rm -rf /')
  })

  it('rejects removing an out-of-range job id', async () => {
    mockedSpawnSync.mockReturnValue(spawnResult({ stdout: '0 * * * * echo hello\n' }))
    const ctx = createMockToolContext('cron', { action: 'remove', jobId: 10 })
    const block = await runToolStream(cron, ctx)
    const text = getToolResultText(block)
    expect(text).toContain('Job ID 10 is out of range')
    expect(mockedSpawnSync).toHaveBeenCalledTimes(1)
  })

  it('rejects editing comment lines', async () => {
    mockedSpawnSync.mockReturnValue(spawnResult({ stdout: '# comment\n0 * * * * echo hello\n' }))
    const ctx = createMockToolContext('cron', {
      action: 'edit',
      jobId: 0,
      schedule: '0 3 * * *',
      command: 'new_command.sh',
    })
    const block = await runToolStream(cron, ctx)
    const text = getToolResultText(block)
    expect(text).toContain('Line 0 is a comment')
    expect(mockedSpawnSync).toHaveBeenCalledTimes(1)
  })

  it('returns unknown action error for invalid actions', async () => {
    const ctx = createMockToolContext('cron', { action: 'invalid_action' })
    const block = await runToolStream(cron, ctx)
    const text = getToolResultText(block)
    expect(text).toContain("Unknown action 'invalid_action'")
  })

  it('sanitizes descriptions to prevent crontab line injection', () => {
    expect(sanitizeDescription('safe comment\n0 * * * * rm -rf /')).toBe('safe comment 0 * * * * rm -rf /')
    expect(sanitizeDescription('line1\r\nline2')).toBe('line1 line2')
  })
})
