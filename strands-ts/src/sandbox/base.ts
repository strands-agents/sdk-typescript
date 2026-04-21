/**
 * Base sandbox interface for agent code execution environments.
 *
 * Defines the abstract `Sandbox` class and supporting types:
 * - {@link ExecutionResult} — result of command/code execution
 * - {@link FileInfo} — metadata about a file in the sandbox
 * - {@link OutputFile} — a file produced as output by code execution
 * - {@link StreamChunk} — a typed chunk of streaming output (stdout or stderr)
 *
 * Sandbox implementations provide the runtime context where tools execute code,
 * run commands, and interact with a filesystem. Multiple tools share the same
 * Sandbox instance, giving them a common working directory, environment variables,
 * and filesystem.
 *
 * Class hierarchy:
 * - `Sandbox`: All operations abstract. Implement for non-shell-based sandboxes.
 * - `ShellBasedSandbox` (in shell-based.ts): Shell-based defaults for file operations.
 * - `NoOpSandbox` (in noop.ts): Raises errors for all operations.
 */

/**
 * Type of a streaming output chunk.
 *
 * - `"stdout"`: Standard output from the command or code.
 * - `"stderr"`: Standard error from the command or code.
 */
export type StreamType = 'stdout' | 'stderr'

/**
 * A typed chunk of streaming output from command or code execution.
 *
 * Allows consumers to distinguish stdout from stderr during streaming,
 * enabling richer UIs and more precise output handling.
 */
export interface StreamChunk {
  /**
   * The text content of the chunk.
   */
  data: string

  /**
   * Whether this chunk is from stdout or stderr.
   */
  streamType: StreamType
}

/**
 * Metadata about a file or directory in a sandbox.
 *
 * Provides minimal structured information that lets tools distinguish
 * files from directories and report sizes. Fields `isDir` and `size`
 * are optional — implementations that cannot provide accurate data
 * return `undefined` instead of lying.
 */
export interface FileInfo {
  /**
   * The file or directory name (not the full path).
   */
  name: string

  /**
   * Whether this entry is a directory. `undefined` if unknown.
   */
  isDir?: boolean

  /**
   * File size in bytes. `undefined` if unknown.
   */
  size?: number
}

/**
 * A file produced as output by code execution.
 *
 * Used to carry binary artifacts (images, charts, PDFs, compiled files)
 * from sandbox execution back to the agent. Tools can convert these
 * to the SDK's media content types for the model.
 */
export interface OutputFile {
  /**
   * Filename (e.g., `"plot.png"`).
   */
  name: string

  /**
   * Raw file content as bytes.
   */
  content: Uint8Array

  /**
   * MIME type of the content (e.g., `"image/png"`).
   */
  mimeType: string
}

/**
 * Result of code or command execution in a sandbox.
 */
export interface ExecutionResult {
  /**
   * The exit code of the command or code execution.
   */
  exitCode: number

  /**
   * Standard output captured from execution.
   */
  stdout: string

  /**
   * Standard error captured from execution.
   */
  stderr: string

  /**
   * Files produced by the execution (e.g., images, charts).
   * Shell-based sandboxes typically return an empty list.
   */
  outputFiles: OutputFile[]
}

/**
 * Abstract execution environment for agent tools.
 *
 * A Sandbox provides the runtime context where tools execute code,
 * run commands, and interact with a filesystem. Multiple tools share
 * the same Sandbox instance, giving them a common working directory,
 * environment variables, and filesystem.
 *
 * The sandbox follows the SDK's streaming pattern: streaming methods
 * (`executeStreaming`, `executeCodeStreaming`) are the abstract primitives
 * that implementations must provide. Non-streaming convenience methods
 * (`execute`, `executeCode`) consume the stream and return the final
 * `ExecutionResult`.
 *
 * Streaming methods yield `StreamChunk` objects that carry both
 * the text data and the stream type (stdout or stderr), followed by a
 * final `ExecutionResult`.
 *
 * @example
 * ```typescript
 * import { HostSandbox } from '@strands-agents/sdk/sandbox'
 *
 * const sandbox = new HostSandbox({ workingDir: '/tmp/my-sandbox' })
 * const result = await sandbox.execute('echo hello')
 * console.log(result.stdout) // "hello\n"
 * ```
 */
export abstract class Sandbox {
  /**
   * Execute a shell command, streaming output.
   *
   * Yields `StreamChunk` objects for stdout and stderr output
   * as it arrives. The final yield is an `ExecutionResult` with
   * the exit code and complete output.
   *
   * @param command - The shell command to execute.
   * @param options - Execution options (timeout, cwd).
   * @returns Async generator yielding StreamChunks then a final ExecutionResult.
   */
  abstract executeStreaming(
    command: string,
    options?: ExecuteOptions
  ): AsyncGenerator<StreamChunk | ExecutionResult, void, undefined>

  /**
   * Execute code in the sandbox, streaming output.
   *
   * @param code - The source code to execute.
   * @param language - The programming language interpreter to use.
   * @param options - Execution options (timeout, cwd).
   * @returns Async generator yielding StreamChunks then a final ExecutionResult.
   */
  abstract executeCodeStreaming(
    code: string,
    language: string,
    options?: ExecuteOptions
  ): AsyncGenerator<StreamChunk | ExecutionResult, void, undefined>

  /**
   * Read a file from the sandbox filesystem.
   *
   * Returns raw bytes to support both text and binary files.
   * Use {@link readText} for a convenience wrapper that decodes to a string.
   *
   * @param path - Path to the file to read.
   * @returns The file contents as a Uint8Array.
   */
  abstract readFile(path: string): Promise<Uint8Array>

  /**
   * Write a file to the sandbox filesystem.
   *
   * Accepts raw bytes to support both text and binary content.
   * Use {@link writeText} for a convenience wrapper that encodes a string.
   *
   * Implementations should create parent directories if they do not exist.
   *
   * @param path - Path to the file to write.
   * @param content - The content to write as bytes.
   */
  abstract writeFile(path: string, content: Uint8Array): Promise<void>

  /**
   * Remove a file from the sandbox filesystem.
   *
   * @param path - Path to the file to remove.
   */
  abstract removeFile(path: string): Promise<void>

  /**
   * List files in a sandbox directory.
   *
   * Returns structured `FileInfo` entries with metadata.
   *
   * @param path - Path to the directory to list.
   * @returns A list of FileInfo entries for the directory contents.
   */
  abstract listFiles(path: string): Promise<FileInfo[]>

  /**
   * Execute a shell command and return the result.
   *
   * Convenience wrapper that consumes `executeStreaming` and returns
   * the final `ExecutionResult`. This is the common case — use
   * `executeStreaming` when you need to process output as it arrives.
   *
   * @param command - The shell command to execute.
   * @param options - Execution options (timeout, cwd).
   * @returns The final ExecutionResult from execution.
   */
  async execute(command: string, options?: ExecuteOptions): Promise<ExecutionResult> {
    let result: ExecutionResult | undefined
    for await (const chunk of this.executeStreaming(command, options)) {
      if ('exitCode' in chunk) {
        result = chunk as ExecutionResult
      }
    }
    if (!result) {
      throw new Error('executeStreaming() did not yield an ExecutionResult')
    }
    return result
  }

  /**
   * Execute code and return the result.
   *
   * Convenience wrapper that consumes `executeCodeStreaming` and returns
   * the final `ExecutionResult`.
   *
   * @param code - The source code to execute.
   * @param language - The programming language interpreter to use.
   * @param options - Execution options (timeout, cwd).
   * @returns The final ExecutionResult from execution.
   */
  async executeCode(code: string, language: string, options?: ExecuteOptions): Promise<ExecutionResult> {
    let result: ExecutionResult | undefined
    for await (const chunk of this.executeCodeStreaming(code, language, options)) {
      if ('exitCode' in chunk) {
        result = chunk as ExecutionResult
      }
    }
    if (!result) {
      throw new Error('executeCodeStreaming() did not yield an ExecutionResult')
    }
    return result
  }

  /**
   * Read a text file from the sandbox filesystem.
   *
   * Convenience wrapper around `readFile` that decodes bytes to a string.
   *
   * @param path - Path to the file to read.
   * @returns The file contents as a string.
   */
  async readText(path: string): Promise<string> {
    const data = await this.readFile(path)
    return new TextDecoder('utf-8').decode(data)
  }

  /**
   * Write a text file to the sandbox filesystem.
   *
   * Convenience wrapper around `writeFile` that encodes a string to bytes.
   *
   * @param path - Path to the file to write.
   * @param content - The text content to write.
   */
  async writeText(path: string, content: string): Promise<void> {
    await this.writeFile(path, new TextEncoder().encode(content))
  }
}

/**
 * Options for command/code execution.
 */
export interface ExecuteOptions {
  /**
   * Maximum execution time in seconds. `undefined` means no timeout.
   */
  timeout?: number

  /**
   * Working directory for execution. `undefined` means use the sandbox's default.
   */
  cwd?: string
}
