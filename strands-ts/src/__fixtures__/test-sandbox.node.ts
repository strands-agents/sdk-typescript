import { spawn } from 'child_process'
import { ShellSandbox } from '../sandbox/shell.js'
import { shellQuote } from '../utils/shell-quote.js'
import { streamProcess } from '../sandbox/stream-process.js'
import type { ExecuteOptions } from '../sandbox/base.js'
import type { ExecutionResult, StreamChunk } from '../sandbox/types.js'

/**
 * Test sandbox that executes commands within a specific working directory.
 *
 * Extends ShellSandbox (same base as DockerSandbox and RemoteSandbox) so it
 * exercises the same code path real sandboxes use: base64 file encoding,
 * shell quoting, ls parsing, etc. The only difference is commands run on
 * the host rather than in a container or over SSH.
 */
export class TestSandbox extends ShellSandbox {
  readonly workingDir: string

  constructor(workingDir: string) {
    super()
    this.workingDir = workingDir
  }

  async *executeStreaming(
    command: string,
    options?: ExecuteOptions
  ): AsyncGenerator<StreamChunk | ExecutionResult, void, undefined> {
    const cwd = options?.cwd ?? this.workingDir
    const fullCommand = `cd ${shellQuote(cwd)} && ${command}`
    const proc = spawn('sh', ['-c', fullCommand])
    yield* streamProcess(proc, { timeout: options?.timeout, signal: options?.signal })
  }
}
