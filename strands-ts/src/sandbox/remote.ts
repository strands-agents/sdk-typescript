/**
 * Remote sandbox implementation using SSH transport.
 *
 * Extends ShellSandbox — all file operations and code execution route
 * through SSH to a remote host. Only executeStreaming() is implemented;
 * everything else comes free from ShellSandbox.
 */

import { spawn } from 'child_process'
import type { ExecuteOptions } from './base.js'
import { ShellSandbox } from './shell.js'
import { shellQuote } from '../utils/shell-quote.js'
import { streamProcess } from './stream-process.js'
import type { ExecutionResult, StreamChunk } from './types.js'

const BLOCKED_SSH_OPTIONS = [
  'proxycommand',
  'localcommand',
  'permitlocalcommand',
  'proxyusefdpass',
  'localforward',
  'remoteforward',
  'dynamicforward',
]

/**
 * Options for constructing a {@link RemoteSandbox}.
 */
export interface RemoteSandboxOptions {
  /** SSH host (e.g., "localhost", "user\@remote-host"). */
  host: string
  /** Working directory on the remote host. */
  workingDir: string
  /** Path to SSH private key file. */
  identityFile?: string
  /** SSH port. Defaults to 22. */
  port?: number
  /**
   * Allow connections to hosts with unknown or changed SSH keys.
   *
   * **Security warning**: Setting this to `true` disables host key verification,
   * enabling man-in-the-middle attacks. Only use for local development or trusted networks.
   *
   * When `false` or unset, uses `accept-new` (trust on first connect, reject if key changes).
   */
  allowUnknownHosts?: boolean
  /**
   * Additional SSH options passed as -o flags (e.g., ["ConnectTimeout=10", "ServerAliveInterval=60"]).
   *
   * Options that execute commands on the host (ProxyCommand, LocalCommand, PermitLocalCommand,
   * ProxyUseFdpass, LocalForward, RemoteForward, DynamicForward) are blocked and will throw.
   */
  sshOptions?: string[]
}

/**
 * Execute commands on a remote host via SSH.
 *
 * All sandbox operations (file I/O, code execution, directory listing)
 * route through SSH. Subclasses ShellSandbox, so only executeStreaming()
 * is implemented — file ops use base64 encoding over the SSH channel.
 *
 * @example
 * ```typescript
 * const sandbox = new RemoteSandbox({
 *   host: 'localhost',
 *   workingDir: '/tmp/remote-sandbox',
 *   identityFile: '~/.ssh/localhost_key',
 * })
 * await sandbox.start()
 * const result = await sandbox.execute('echo hello')
 * ```
 */
export class RemoteSandbox extends ShellSandbox {
  readonly host: string
  readonly workingDir: string
  private readonly _identityFile: string | undefined
  private readonly _port: number
  private readonly _allowUnknownHosts: boolean
  private readonly _sshOptions: string[]

  constructor(options: RemoteSandboxOptions) {
    super()
    this.host = options.host
    this.workingDir = options.workingDir
    this._identityFile = options.identityFile
    this._port = options.port ?? 22
    this._allowUnknownHosts = options.allowUnknownHosts ?? false
    this._sshOptions = options.sshOptions ?? []
    for (const opt of this._sshOptions) {
      const name = (opt.split(/[=\s]/)[0] ?? '').trim().toLowerCase()
      if (BLOCKED_SSH_OPTIONS.includes(name)) {
        throw new Error(
          `SSH option "${opt.split(/[=\s]/)[0] ?? opt}" is blocked because it can execute commands on the host`
        )
      }
    }
  }

  async start(): Promise<void> {
    const result = await this.execute(`mkdir -p ${shellQuote(this.workingDir)}`, { cwd: '/' })
    if (result.exitCode !== 0) {
      throw new Error(`Failed to create remote working directory: ${result.stderr}`)
    }
  }

  async *executeStreaming(
    command: string,
    options?: ExecuteOptions
  ): AsyncGenerator<StreamChunk | ExecutionResult, void, undefined> {
    const cwd = options?.cwd ?? this.workingDir
    const remoteCommand = `cd ${shellQuote(cwd)} && ${command}`

    const sshArgs: string[] = [
      '-o',
      `StrictHostKeyChecking=${this._allowUnknownHosts ? 'no' : 'accept-new'}`,
      '-o',
      'BatchMode=yes',
      '-p',
      String(this._port),
    ]

    if (this._identityFile) {
      sshArgs.push('-i', this._identityFile)
    }

    sshArgs.push(...this._sshOptions.flatMap((opt) => ['-o', opt]))

    sshArgs.push(this.host, remoteCommand)

    const proc = spawn('ssh', sshArgs)
    yield* streamProcess(proc, { timeout: options?.timeout, signal: options?.signal })
  }
}
