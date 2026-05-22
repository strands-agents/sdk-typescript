/**
 * Docker sandbox implementation.
 *
 * Extends ShellSandbox — runs commands inside a Docker container via `docker exec`.
 * The container is created on `start()` and destroyed on `stop()`.
 * Supports `pause()` via `docker commit` for snapshotting.
 */

import { randomUUID } from 'crypto'
import { spawn, spawnSync, execFile as execFileCb } from 'child_process'
import { promisify } from 'util'
import type { ExecuteOptions } from './base.js'
import { ShellSandbox } from './shell.js'
import { shellQuote } from '../utils/shell-quote.js'
import { streamProcess } from './stream-process.js'
import type { ExecutionResult, SandboxSnapshot, StreamChunk } from './types.js'
import { logger } from '../logging/logger.js'

const execFile = promisify(execFileCb)

const DANGEROUS_MOUNT_PATHS = ['/', '/boot', '/dev', '/etc', '/lib', '/lib64', '/proc', '/sys', '/usr']
const DANGEROUS_MOUNT_TARGETS = ['/var/run/docker.sock']

async function dockerCmd(args: string[]): Promise<{ stdout: string; stderr: string; status: number }> {
  try {
    const { stdout, stderr } = await execFile('docker', args, { encoding: 'utf-8' })
    return { stdout, stderr, status: 0 }
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string; code?: number | string }
    const status = typeof e.code === 'number' ? e.code : 1
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? '', status }
  }
}

/**
 * Options for constructing a {@link DockerSandbox}.
 */
export interface DockerSandboxOptions {
  /** Docker image to use (e.g., "python:3.12", "node:20-alpine"). */
  image: string
  /** Working directory inside the container. Defaults to "/workspace". */
  workingDir?: string
  /** Container name. Auto-generated if not provided. */
  name?: string
  /**
   * Volume mounts in "host:container" format.
   *
   * **Security warning**: Host path mounts bypass container isolation. Avoid mounting
   * sensitive paths (/, /etc, /proc, /sys, /var/run/docker.sock) as they expose the
   * host to LLM-generated commands.
   */
  volumes?: string[]
  /** Environment variables to set in the container. */
  env?: Record<string, string>
  /** Memory limit (e.g., "512m", "2g"). */
  memory?: string
  /** CPU limit (e.g., 1.5 for one and a half cores). */
  cpus?: number
  /** Maximum number of PIDs in the container. Prevents fork bombs. */
  pidsLimit?: number
  /** Docker network mode. Use "none" to disable network access. */
  network?: string
  /** User to run as inside the container. Defaults to "1000:1000" (non-root). Pass "root" to run as root. */
  user?: string
  /**
   * Allow privilege escalation inside the container.
   *
   * When `false` (default), applies `--cap-drop ALL` and `--security-opt no-new-privileges`
   * to prevent setuid escalation and drop all Linux capabilities.
   */
  allowPrivilegeEscalation?: boolean
  /** Snapshot to resume from (image ID from a previous pause). */
  snapshot?: SandboxSnapshot
}

/**
 * Execute commands inside a Docker container.
 *
 * The container is created on {@link start} and destroyed on {@link stop}.
 * All sandbox operations (file I/O, code execution, directory listing)
 * route through `docker exec`. File ops use base64 encoding inherited
 * from ShellSandbox.
 *
 * @example
 * ```typescript
 * const sandbox = new DockerSandbox({ image: 'python:3.12' })
 * await sandbox.start()
 * const result = await sandbox.execute('python3 -c "print(1+1)"')
 * await sandbox.stop()
 * ```
 */
export class DockerSandbox extends ShellSandbox {
  readonly image: string
  readonly workingDir: string
  private readonly _name: string
  private readonly _volumes: string[]
  private readonly _env: Record<string, string>
  private readonly _memory: string | undefined
  private readonly _cpus: number | undefined
  private readonly _pidsLimit: number | undefined
  private readonly _network: string | undefined
  private readonly _user: string
  private readonly _allowPrivilegeEscalation: boolean
  private readonly _snapshot: SandboxSnapshot | undefined
  private _running = false
  private _cleanupRegistered = false

  constructor(options: DockerSandboxOptions) {
    super()
    const snap = options.snapshot?.data
    this.image = options.image
    this.workingDir = options.workingDir ?? (snap?.workingDir as string) ?? '/workspace'
    this._name = options.name ?? `strands-sandbox-${randomUUID()}`
    this._volumes = options.volumes ?? (snap?.volumes as string[]) ?? []
    for (const vol of this._volumes) {
      const hostPath = vol.split(':')[0]?.replace(/\/+$/, '') || '/'
      if (DANGEROUS_MOUNT_PATHS.includes(hostPath) || DANGEROUS_MOUNT_TARGETS.includes(hostPath)) {
        logger.warn(
          `volume=<${vol}> | mounting this host path exposes the host filesystem to LLM-generated commands, bypassing container isolation`
        )
      }
    }
    this._env = options.env ?? (snap?.env as Record<string, string>) ?? {}
    this._memory = options.memory
    this._cpus = options.cpus
    this._pidsLimit = options.pidsLimit
    this._network = options.network
    this._user = options.user ?? '1000:1000'
    this._allowPrivilegeEscalation = options.allowPrivilegeEscalation ?? false
    this._snapshot = options.snapshot
  }

  async start(): Promise<void> {
    if (this._running) return

    const info = await dockerCmd(['info'])
    if (info.status !== 0) {
      throw new Error('Docker is not available. Ensure Docker is installed and running.')
    }

    // Remove any stale container from a previous crash where exit handlers didn't fire
    await dockerCmd(['rm', '-f', this._name])

    const image = this._snapshot ? (this._snapshot.data['imageId'] as string) : this.image

    const args: string[] = ['run', '-d', '--name', this._name, '-w', this.workingDir]

    for (const vol of this._volumes) {
      args.push('-v', vol)
    }

    for (const [key, value] of Object.entries(this._env)) {
      args.push('-e', `${key}=${value}`)
    }

    if (this._memory) args.push('--memory', this._memory)
    if (this._cpus) args.push('--cpus', String(this._cpus))
    if (this._pidsLimit) args.push('--pids-limit', String(this._pidsLimit))
    if (this._network) args.push('--network', this._network)
    args.push('--user', this._user)
    if (!this._allowPrivilegeEscalation) {
      args.push('--cap-drop', 'ALL')
      args.push('--security-opt', 'no-new-privileges')
    }

    args.push(image, 'tail', '-f', '/dev/null')

    const result = await dockerCmd(args)
    if (result.status !== 0) {
      throw new Error(`Failed to start Docker container: ${result.stderr}`)
    }

    this._running = true
    await dockerCmd(['exec', this._name, 'chown', this._user, this.workingDir])
    this._registerCleanup()
  }

  async stop(): Promise<void> {
    if (!this._running) return
    await dockerCmd(['rm', '-f', this._name])
    this._running = false
    this._removeCleanup()
  }

  async pause(): Promise<SandboxSnapshot> {
    if (!this._running) {
      throw new Error('Cannot pause: container is not running')
    }

    const result = await dockerCmd(['commit', this._name])
    if (result.status !== 0) {
      throw new Error(`Failed to snapshot container: ${result.stderr}`)
    }

    return {
      backendId: 'docker',
      data: { imageId: result.stdout.trim(), workingDir: this.workingDir, volumes: this._volumes, env: this._env },
    }
  }

  async *executeStreaming(
    command: string,
    options?: ExecuteOptions
  ): AsyncGenerator<StreamChunk | ExecutionResult, void, undefined> {
    if (!this._running) {
      throw new Error('Container is not running. Call start() before executing commands.')
    }

    const cwd = options?.cwd ?? this.workingDir
    const execCommand = `cd ${shellQuote(cwd)} && ${command}`

    const proc = spawn('docker', ['exec', this._name, 'sh', '-c', execCommand])
    yield* streamProcess(proc, { timeout: options?.timeout, signal: options?.signal })
  }

  private _onExit: (() => void) | undefined
  private _onSigint: (() => void) | undefined
  private _onSigterm: (() => void) | undefined

  private _registerCleanup(): void {
    if (this._cleanupRegistered) return
    this._cleanupRegistered = true

    this._onExit = (): void => {
      if (this._running) {
        // Must be sync: async I/O is not processed during the 'exit' event
        spawnSync('docker', ['rm', '-f', this._name], { stdio: 'pipe', timeout: 5000 })
        this._running = false
      }
    }

    this._onSigint = (): void => {
      this._onExit!()
      this._removeCleanup()
      process.kill(process.pid, 'SIGINT')
    }

    this._onSigterm = (): void => {
      this._onExit!()
      this._removeCleanup()
      process.kill(process.pid, 'SIGTERM')
    }

    process.on('exit', this._onExit)
    process.on('SIGINT', this._onSigint)
    process.on('SIGTERM', this._onSigterm)
  }

  private _removeCleanup(): void {
    if (!this._onExit) return
    process.off('exit', this._onExit)
    process.off('SIGINT', this._onSigint!)
    process.off('SIGTERM', this._onSigterm!)
    this._onExit = undefined
    this._onSigint = undefined
    this._onSigterm = undefined
    this._cleanupRegistered = false
  }
}
