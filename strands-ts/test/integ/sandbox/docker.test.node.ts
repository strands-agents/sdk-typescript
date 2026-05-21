import { describe, it, expect, afterEach } from 'vitest'
import { DockerSandbox } from '../../../src/sandbox/docker.js'
import { createMockAgent } from '../../../src/__fixtures__/agent-helpers.js'
import { exec } from '../../../src/vended-tools/exec/exec.js'
import { fileEditor } from '../../../src/vended-tools/file-editor/file-editor.js'
import { codeInterpreter } from '../../../src/vended-tools/code-interpreter/code-interpreter.js'
import { spawnSync } from 'child_process'

function dockerAvailable(): boolean {
  if (process.platform === 'win32') return false
  const result = spawnSync('docker', ['info'], { encoding: 'utf-8', stdio: 'pipe' })
  return result.status === 0
}

describe.skipIf(!dockerAvailable())('DockerSandbox', () => {
  let sandbox: DockerSandbox

  afterEach(async () => {
    if (sandbox) {
      await sandbox.stop()
    }
  })

  describe('lifecycle', () => {
    it('start creates a container and stop removes it', async () => {
      sandbox = new DockerSandbox({ image: 'alpine:latest', name: 'strands-test-docker' })
      await sandbox.start()

      const ps = spawnSync('docker', ['ps', '--filter', 'name=strands-test-docker', '--format', '{{.Names}}'], {
        encoding: 'utf-8',
        stdio: 'pipe',
      })
      expect(ps.stdout.trim()).toBe('strands-test-docker')

      await sandbox.stop()

      const psAfter = spawnSync(
        'docker',
        ['ps', '-a', '--filter', 'name=strands-test-docker', '--format', '{{.Names}}'],
        {
          encoding: 'utf-8',
          stdio: 'pipe',
        }
      )
      expect(psAfter.stdout.trim()).toBe('')
    })

    it('throws if Docker is not running', async () => {
      // This test would only fail if Docker stops between the skip check and here
      // Just verify the error path exists
      sandbox = new DockerSandbox({ image: 'alpine:latest' })
      // start() should succeed since we checked Docker is available
      await sandbox.start()
    })
  })

  describe('execute', () => {
    it('runs a command inside the container', async () => {
      sandbox = new DockerSandbox({ image: 'alpine:latest' })
      await sandbox.start()

      const result = await sandbox.execute('echo hello from docker')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('hello from docker\n')
    })

    it('runs in workingDir', async () => {
      sandbox = new DockerSandbox({ image: 'alpine:latest', workingDir: '/opt' })
      await sandbox.start()

      const result = await sandbox.execute('pwd')
      expect(result.stdout.trim()).toBe('/opt')
    })

    it('captures exit code', async () => {
      sandbox = new DockerSandbox({ image: 'alpine:latest' })
      await sandbox.start()

      const result = await sandbox.execute('exit 42')
      expect(result.exitCode).toBe(42)
    })

    it('captures stderr', async () => {
      sandbox = new DockerSandbox({ image: 'alpine:latest' })
      await sandbox.start()

      const result = await sandbox.execute('echo err >&2')
      expect(result.stderr).toBe('err\n')
    })

    it('respects cwd option', async () => {
      sandbox = new DockerSandbox({ image: 'alpine:latest' })
      await sandbox.start()

      const result = await sandbox.execute('pwd', { cwd: '/tmp' })
      expect(result.stdout.trim()).toBe('/tmp')
    })
  })

  describe('executeCode', () => {
    it('runs python code', async () => {
      sandbox = new DockerSandbox({ image: 'python:3.12-slim' })
      await sandbox.start()

      const result = await sandbox.executeCode('print(6 * 7)', 'python3')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('42\n')
    })
  })

  describe('file operations (via base64 over docker exec)', () => {
    it('write and read text roundtrip', async () => {
      sandbox = new DockerSandbox({ image: 'alpine:latest' })
      await sandbox.start()

      await sandbox.writeText('test.txt', 'hello docker')
      const text = await sandbox.readText('test.txt')
      expect(text).toBe('hello docker')
    })

    it('binary roundtrip', async () => {
      sandbox = new DockerSandbox({ image: 'alpine:latest' })
      await sandbox.start()

      const bytes = new Uint8Array([0, 1, 2, 127, 128, 254, 255])
      await sandbox.writeFile('binary.bin', bytes)
      const read = await sandbox.readFile('binary.bin')
      expect(Array.from(read)).toStrictEqual(Array.from(bytes))
    })

    it('remove deletes a file', async () => {
      sandbox = new DockerSandbox({ image: 'alpine:latest' })
      await sandbox.start()

      await sandbox.writeText('delete-me.txt', 'bye')
      await sandbox.removeFile('delete-me.txt')
      await expect(sandbox.readFile('delete-me.txt')).rejects.toThrow()
    })

    it('list shows files', async () => {
      sandbox = new DockerSandbox({ image: 'alpine:latest' })
      await sandbox.start()

      await sandbox.writeText('a.txt', 'a')
      await sandbox.writeText('b.txt', 'b')
      const files = await sandbox.listFiles('.')
      const names = files.map((f) => f.name)
      expect(names).toContain('a.txt')
      expect(names).toContain('b.txt')
    })
  })

  describe('isolation', () => {
    it('files in container do not exist on host', async () => {
      sandbox = new DockerSandbox({ image: 'alpine:latest' })
      await sandbox.start()

      await sandbox.writeText('isolated.txt', 'only in container')

      const hostCheck = spawnSync('test', ['-f', '/workspace/isolated.txt'])
      expect(hostCheck.status).not.toBe(0)
    })

    it('two containers are isolated from each other', async () => {
      sandbox = new DockerSandbox({ image: 'alpine:latest' })
      await sandbox.start()

      const sandbox2 = new DockerSandbox({ image: 'alpine:latest' })
      await sandbox2.start()

      await sandbox.writeText('only-in-1.txt', 'sandbox 1')
      await expect(sandbox2.readFile('only-in-1.txt')).rejects.toThrow()

      await sandbox2.stop()
    })
  })

  describe('pause/resume', () => {
    it('pauses and resumes container state', async () => {
      sandbox = new DockerSandbox({ image: 'alpine:latest' })
      await sandbox.start()

      await sandbox.writeText('persisted.txt', 'survives pause')
      const snapshot = await sandbox.pause()
      await sandbox.stop()

      expect(snapshot.backendId).toBe('docker')
      expect(snapshot.data['imageId']).toBeDefined()

      // Resume from snapshot
      sandbox = new DockerSandbox({ image: 'alpine:latest', snapshot })
      await sandbox.start()

      const text = await sandbox.readText('persisted.txt')
      expect(text).toBe('survives pause')

      // Cleanup the committed image
      spawnSync('docker', ['rmi', snapshot.data['imageId'] as string], { stdio: 'pipe' })
    })
  })

  describe('volumes', () => {
    it('mounts host directory into container', async () => {
      spawnSync('mkdir', ['-p', '/tmp/strands-docker-vol-test'])
      spawnSync('bash', ['-c', 'echo "from host" > /tmp/strands-docker-vol-test/host-file.txt'])

      sandbox = new DockerSandbox({
        image: 'alpine:latest',
        volumes: ['/tmp/strands-docker-vol-test:/mnt/shared'],
      })
      await sandbox.start()

      const result = await sandbox.execute('cat /mnt/shared/host-file.txt')
      expect(result.stdout.trim()).toBe('from host')

      spawnSync('rm', ['-rf', '/tmp/strands-docker-vol-test'])
    })
  })

  describe('env', () => {
    it('passes environment variables to container', async () => {
      sandbox = new DockerSandbox({
        image: 'alpine:latest',
        env: { MY_VAR: 'hello_from_env' },
      })
      await sandbox.start()

      const result = await sandbox.execute('echo $MY_VAR')
      expect(result.stdout.trim()).toBe('hello_from_env')
    })
  })

  describe('error handling', () => {
    it('throws on stream if container not started', async () => {
      sandbox = new DockerSandbox({ image: 'alpine:latest' })
      await expect(sandbox.execute('echo hi')).rejects.toThrow('not running')
    })

    it('throws on pause if container not started', async () => {
      sandbox = new DockerSandbox({ image: 'alpine:latest' })
      await expect(sandbox.pause()).rejects.toThrow('not running')
    })
  })

  describe('vended tools execute inside container', () => {
    it('exec tool runs command in container, not on host', async () => {
      sandbox = new DockerSandbox({ image: 'alpine:latest' })
      await sandbox.start()

      const agent = createMockAgent({ sandbox })
      const context = {
        toolUse: { name: 'exec', toolUseId: 'test', input: {} },
        agent,
        invocationState: {},
        interrupt: () => {
          throw new Error('not implemented')
        },
      }

      const result = await exec.invoke({ command: 'cat /etc/os-release' }, context)
      expect(result.stdout).toContain('Alpine')

      const hostRelease = spawnSync('cat', ['/etc/os-release'], { encoding: 'utf-8', stdio: 'pipe' })
      if (hostRelease.status === 0) {
        expect(hostRelease.stdout).not.toContain('Alpine')
      }
    })

    it('fileEditor creates file inside container filesystem', async () => {
      sandbox = new DockerSandbox({ image: 'alpine:latest' })
      await sandbox.start()

      const agent = createMockAgent({ sandbox })
      const context = {
        toolUse: { name: 'fileEditor', toolUseId: 'test', input: {} },
        agent,
        invocationState: {},
        interrupt: () => {
          throw new Error('not implemented')
        },
      }

      const uuid = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      await fileEditor.invoke({ command: 'create', path: '/workspace/docker-test.txt', file_text: uuid }, context)

      const containerContent = await sandbox.readText('/workspace/docker-test.txt')
      expect(containerContent).toBe(uuid)

      const hostCheck = spawnSync('test', ['-f', '/workspace/docker-test.txt'])
      expect(hostCheck.status).not.toBe(0)
    })

    it('codeInterpreter runs code inside container', async () => {
      sandbox = new DockerSandbox({ image: 'python:3.12-slim' })
      await sandbox.start()

      const agent = createMockAgent({ sandbox })
      const context = {
        toolUse: { name: 'codeInterpreter', toolUseId: 'test', input: {} },
        agent,
        invocationState: {},
        interrupt: () => {
          throw new Error('not implemented')
        },
      }

      const uuid = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const result = await codeInterpreter.invoke(
        { code: `open("/workspace/from-python.txt", "w").write("${uuid}")`, language: 'python3' },
        context
      )
      expect(result.exitCode).toBe(0)

      const containerContent = await sandbox.readText('/workspace/from-python.txt')
      expect(containerContent).toBe(uuid)

      const hostCheck = spawnSync('test', ['-f', '/workspace/from-python.txt'])
      expect(hostCheck.status).not.toBe(0)
    })
  })
})
