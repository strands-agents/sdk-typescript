/**
 * Docker sandbox — executes commands in a Docker container via `docker exec`.
 */

import type { ExecuteOptions } from './base.js'
import { PosixShellSandbox } from './posix-shell.js'
import { streamProcess } from './stream-process.js'
import type { ExecutionResult, StreamChunk } from './types.js'

/**
 * Options for constructing a {@link DockerSandbox}.
 */
export interface DockerSandboxOptions {
  /** ID or name of a running Docker container. */
  containerId: string
  /**
   * Working directory inside the container. Defaults to `"/tmp"`.
   *
   * `/tmp` is used because the default non-root user (`1000:1000`) with `--cap-drop ALL`
   * cannot create or chown directories. `/tmp` is world-writable on every standard base image.
   * If you specify a custom path, it must already exist in the image and be writable by `user`.
   */
  workingDir?: string
  /**
   * User to run as inside the container. Defaults to `"1000:1000"` (non-root).
   * Pass `"root"` to run as root.
   */
  user?: string
}

/** Execute commands in a Docker container via `docker exec`. */
export class DockerSandbox extends PosixShellSandbox {
  readonly workingDir: string
  private readonly _containerId: string
  private readonly _user: string

  constructor(options: DockerSandboxOptions) {
    super()
    this._containerId = options.containerId
    this.workingDir = options.workingDir ?? '/tmp'
    this._user = options.user ?? '1000:1000'
  }

  async *executeStreaming(
    command: string,
    options?: ExecuteOptions
  ): AsyncGenerator<StreamChunk | ExecutionResult, void, undefined> {
    const cwd = options?.cwd ?? this.workingDir

    yield* streamProcess('docker', ['exec', '--user', this._user, '-w', cwd, this._containerId, 'sh', '-c', command], {
      timeout: options?.timeout,
      signal: options?.signal,
      enoentMessage: 'docker is not installed or not on PATH',
    })
  }
}
