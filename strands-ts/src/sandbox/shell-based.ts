/**
 * Shell-based sandbox with default implementations for file and code operations.
 *
 * Defines the {@link ShellBasedSandbox} abstract class, which provides
 * shell-command-based defaults for file operations (read, write, remove, list)
 * and code execution. Subclasses only need to implement `executeStreaming()`.
 *
 * Use this for remote environments where only shell access is available
 * (e.g., Docker containers, SSH connections). For local execution, use
 * {@link HostSandbox} which uses native Node.js methods instead.
 *
 * Class hierarchy:
 * - `Sandbox` (ABC, all abstract)
 *   - `ShellBasedSandbox` (ABC, only `executeStreaming()` abstract — shell-based file ops + execute_code)
 */

import type { ExecutionResult, ExecuteOptions, FileInfo, StreamChunk } from './base.js'
import { Sandbox } from './base.js'

/**
 * Shell-quote a string for safe use in shell commands.
 *
 * Wraps the string in single quotes and escapes embedded single quotes,
 * equivalent to Python's `shlex.quote()`.
 */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

/**
 * Abstract sandbox that provides shell-based defaults for file and code operations.
 *
 * Subclasses only need to implement {@link executeStreaming}. The remaining
 * operations — `executeCodeStreaming`, `readFile`, `writeFile`,
 * `removeFile`, and `listFiles` — are implemented via shell commands
 * piped through `executeStreaming()`.
 *
 * This class is intended for remote execution environments where only
 * shell access is available (e.g., Docker containers, SSH connections).
 * For local execution, use {@link HostSandbox} which uses native Node.js
 * methods for better safety and reliability.
 *
 * Subclasses may override any method with a native implementation for
 * better performance.
 *
 * @example
 * ```typescript
 * class DockerSandbox extends ShellBasedSandbox {
 *   async *executeStreaming(command, options) {
 *     // Run command in Docker container
 *   }
 * }
 * ```
 */
export abstract class ShellBasedSandbox extends Sandbox {
  /**
   * Execute code in the sandbox, streaming output.
   *
   * The default implementation passes code to the language interpreter
   * via `-c` with proper shell quoting. Both the `language` and
   * `code` parameters are sanitized with shell quoting to prevent
   * command injection.
   *
   * @param code - The source code to execute.
   * @param language - The programming language interpreter to use
   *   (e.g., `"python"`, `"node"`, `"ruby"`).
   * @param options - Execution options (timeout, cwd).
   * @returns Async generator yielding StreamChunks then a final ExecutionResult.
   */
  async *executeCodeStreaming(
    code: string,
    language: string,
    options?: ExecuteOptions
  ): AsyncGenerator<StreamChunk | ExecutionResult, void, undefined> {
    yield* this.executeStreaming(`${shellQuote(language)} -c ${shellQuote(code)}`, options)
  }

  /**
   * Read a file from the sandbox filesystem as raw bytes.
   *
   * Uses `base64` to encode the file content for safe transport
   * through the shell text layer, then decodes on the Node.js side.
   * This preserves binary content (images, PDFs, compiled files)
   * that would be corrupted by direct `cat` through a text pipe.
   *
   * @param path - Path to the file to read.
   * @returns The file contents as a Uint8Array.
   * @throws If the file does not exist or cannot be read.
   */
  async readFile(path: string): Promise<Uint8Array> {
    const result = await this.execute(`base64 ${shellQuote(path)}`)
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || `Failed to read file: ${path}`)
    }
    const decoded = globalThis.atob(result.stdout.trim())
    return Uint8Array.from(decoded, (c) => c.charCodeAt(0))
  }

  /**
   * Write bytes to a file in the sandbox filesystem.
   *
   * Uses `base64` encoding to safely transport binary content through
   * the shell text layer. Parent directories are created automatically
   * via `mkdir -p`.
   *
   * @param path - Path to the file to write.
   * @param content - The content to write as bytes.
   * @throws If the file cannot be written.
   */
  async writeFile(path: string, content: Uint8Array): Promise<void> {
    const binary = Array.from(content, (byte) => String.fromCharCode(byte)).join('')
    const encoded = globalThis.btoa(binary)
    const quotedPath = shellQuote(path)
    const cmd = `mkdir -p "$(dirname ${quotedPath})" && printf '%s' ${shellQuote(encoded)} | base64 -d > ${quotedPath}`
    const result = await this.execute(cmd)
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || `Failed to write file: ${path}`)
    }
  }

  /**
   * Remove a file from the sandbox filesystem.
   *
   * @param path - Path to the file to remove.
   * @throws If the file does not exist.
   */
  async removeFile(path: string): Promise<void> {
    const result = await this.execute(`rm ${shellQuote(path)}`)
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || `Failed to remove file: ${path}`)
    }
  }

  /**
   * List files in a sandbox directory with structured metadata.
   *
   * Uses `ls -1aF` to include hidden files (dotfiles) and identify
   * directories. Returns {@link FileInfo} entries with name and isDir.
   * Size is `undefined` for shell-based listing.
   *
   * @param path - Path to the directory to list.
   * @returns A list of FileInfo entries.
   * @throws If the directory does not exist.
   */
  async listFiles(path: string): Promise<FileInfo[]> {
    const result = await this.execute(`ls -1aF ${shellQuote(path)}`)
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || `Failed to list files: ${path}`)
    }

    const entries: FileInfo[] = []
    for (const line of result.stdout.trim().split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed === '.' || trimmed === '..' || trimmed === './' || trimmed === '../') {
        continue
      }
      const isDir = trimmed.endsWith('/')
      // Strip the type indicator from the name (ls -F appends / @ * = |)
      const name = trimmed.replace(/[/@*=|]$/, '')
      if (name) {
        entries.push({ name, isDir })
      }
    }
    return entries
  }
}
