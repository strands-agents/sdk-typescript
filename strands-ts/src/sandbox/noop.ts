/**
 * No-op sandbox implementation that disables all sandbox functionality.
 *
 * Use `NoOpSandbox` to explicitly disable sandbox features on an agent.
 * All operations throw `Error` with a clear message.
 *
 * @example
 * ```typescript
 * import { Agent } from '@strands-agents/sdk'
 * import { NoOpSandbox } from '@strands-agents/sdk/sandbox'
 *
 * const agent = new Agent({ sandbox: new NoOpSandbox() })
 * ```
 */

import type { ExecutionResult, ExecuteOptions, FileInfo, StreamChunk } from './base.js'
import { Sandbox } from './base.js'

/**
 * No-op sandbox that throws errors for all operations.
 *
 * Use this to explicitly disable sandbox functionality on an agent.
 * Any tool that attempts to use the sandbox will get a clear error
 * indicating that sandbox is disabled.
 *
 * @example
 * ```typescript
 * import { Agent, NoOpSandbox } from '@strands-agents/sdk'
 *
 * const agent = new Agent({ sandbox: new NoOpSandbox() })
 * ```
 */
export class NoOpSandbox extends Sandbox {
  async *executeStreaming(
    _command: string,
    _options?: ExecuteOptions
  ): AsyncGenerator<StreamChunk | ExecutionResult, void, undefined> {
    throw new Error('Sandbox is disabled (NoOpSandbox). Cannot execute commands.')
    // eslint-disable-next-line no-unreachable
    yield undefined as never
  }

  async *executeCodeStreaming(
    _code: string,
    _language: string,
    _options?: ExecuteOptions
  ): AsyncGenerator<StreamChunk | ExecutionResult, void, undefined> {
    throw new Error('Sandbox is disabled (NoOpSandbox). Cannot execute code.')
    // eslint-disable-next-line no-unreachable
    yield undefined as never
  }

  async readFile(_path: string): Promise<Uint8Array> {
    throw new Error('Sandbox is disabled (NoOpSandbox). Cannot read files.')
  }

  async writeFile(_path: string, _content: Uint8Array): Promise<void> {
    throw new Error('Sandbox is disabled (NoOpSandbox). Cannot write files.')
  }

  async removeFile(_path: string): Promise<void> {
    throw new Error('Sandbox is disabled (NoOpSandbox). Cannot remove files.')
  }

  async listFiles(_path: string): Promise<FileInfo[]> {
    throw new Error('Sandbox is disabled (NoOpSandbox). Cannot list files.')
  }
}
