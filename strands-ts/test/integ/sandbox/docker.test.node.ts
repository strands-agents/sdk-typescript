import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync, spawnSync } from 'child_process'
import { DockerSandbox } from '../../../src/sandbox/docker.js'

const CONTAINER_NAME = 'strands-integ-docker-sandbox'

function dockerAvailable(): boolean {
  if (process.platform === 'win32') return false
  return spawnSync('docker', ['info'], { stdio: 'pipe' }).status === 0
}

describe.skipIf(!dockerAvailable())('DockerSandbox (integration)', () => {
  beforeAll(() => {
    spawnSync('docker', ['rm', '-f', CONTAINER_NAME], { stdio: 'pipe' })
    execSync(`docker run -d --name ${CONTAINER_NAME} python:3.12-slim tail -f /dev/null`, { stdio: 'pipe' })
  })

  afterAll(() => {
    spawnSync('docker', ['rm', '-f', CONTAINER_NAME], { stdio: 'pipe' })
  })

  it('runs commands and captures stdout, stderr, and exit code', async () => {
    const sandbox = new DockerSandbox({ containerId: CONTAINER_NAME })

    const result = await sandbox.execute('echo hello && echo err >&2')
    expect(result).toStrictEqual({
      type: 'executionResult',
      exitCode: 0,
      stdout: 'hello\n',
      stderr: 'err\n',
      outputFiles: [],
    })

    const failed = await sandbox.execute('exit 42')
    expect(failed.exitCode).toBe(42)
  })

  it('runs python via executeCode', async () => {
    const sandbox = new DockerSandbox({ containerId: CONTAINER_NAME })

    const result = await sandbox.executeCode('print(6 * 7)', 'python3')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('42\n')
  })

  it('round-trips text and binary files', async () => {
    const sandbox = new DockerSandbox({ containerId: CONTAINER_NAME })

    await sandbox.writeText('greeting.txt', 'hello docker')
    expect(await sandbox.readText('greeting.txt')).toBe('hello docker')

    const bytes = new Uint8Array([0, 1, 2, 127, 128, 254, 255])
    await sandbox.writeFile('binary.bin', bytes)
    expect(Array.from(await sandbox.readFile('binary.bin'))).toStrictEqual(Array.from(bytes))
  })

  it('lists and removes files', async () => {
    const sandbox = new DockerSandbox({ containerId: CONTAINER_NAME })

    await sandbox.writeText('a.txt', 'a')
    await sandbox.writeText('b.txt', 'b')

    const names = (await sandbox.listFiles('.')).map((f) => f.name)
    expect(names).toContain('a.txt')
    expect(names).toContain('b.txt')

    await sandbox.removeFile('a.txt')
    await expect(sandbox.readFile('a.txt')).rejects.toThrow()
  })

  it('respects custom workingDir', async () => {
    const sandbox = new DockerSandbox({ containerId: CONTAINER_NAME, workingDir: '/opt' })

    const result = await sandbox.execute('pwd')
    expect(result.stdout.trim()).toBe('/opt')
  })

  it('respects per-command cwd override', async () => {
    const sandbox = new DockerSandbox({ containerId: CONTAINER_NAME })

    const result = await sandbox.execute('pwd', { cwd: '/usr' })
    expect(result.stdout.trim()).toBe('/usr')
  })
})
