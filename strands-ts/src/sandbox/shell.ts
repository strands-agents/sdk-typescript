/**
 * Shell sandbox with default implementations for file and code operations.
 *
 * Subclasses only need to implement {@link ShellSandbox.executeStreaming} —
 * all other operations are implemented by running shell commands through it.
 * Use this for remote environments where only shell access is available
 * (Docker containers, SSH connections, cloud runtimes).
 */

import { Sandbox } from './base.js'
import type { ExecuteOptions } from './base.js'
import { LANGUAGE_PATTERN } from './constants.js'
import type { ExecutionResult, FileInfo, StreamChunk } from './types.js'
import { shellQuote } from '../utils/shell-quote.js'

/**
 * Abstract sandbox that provides shell-based defaults for file and code operations.
 *
 * Subclasses only need to implement {@link executeStreaming}. The remaining
 * operations — `executeCodeStreaming`, `readFile`, `writeFile`, `removeFile`,
 * and `listFiles` — are implemented via shell commands piped through
 * `executeStreaming`.
 *
 * Subclasses may override any method with a native implementation for
 * better performance or to handle edge cases (e.g., binary-safe file
 * transfer via Docker stdin pipes, or native API calls for cloud backends).
 */
export abstract class ShellSandbox extends Sandbox {
  async *executeCodeStreaming(
    code: string,
    language: string,
    options?: ExecuteOptions
  ): AsyncGenerator<StreamChunk | ExecutionResult, void, undefined> {
    if (!LANGUAGE_PATTERN.test(language)) {
      throw new Error(`language parameter contains unsafe characters: ${language}`)
    }
    const encoded = btoa(Array.from(new TextEncoder().encode(code), (b) => String.fromCharCode(b)).join(''))
    const eof = `STRANDS_EOF_${crypto.randomUUID().slice(0, 16)}`
    yield* this.executeStreaming(`base64 -d << '${eof}' | ${language}\n${encoded}\n${eof}`, options)
  }

  async readFile(path: string): Promise<Uint8Array> {
    const result = await this.execute(`base64 < ${shellQuote(path)}`)
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || `Failed to read file: ${path}`)
    }
    const cleaned = result.stdout.replace(/\s/g, '')
    const binary = atob(cleaned)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }

  async writeFile(path: string, content: Uint8Array): Promise<void> {
    const binary = Array.from(content, (byte) => String.fromCharCode(byte)).join('')
    const encoded = btoa(binary)
    const quoted = shellQuote(path)
    const eof = `STRANDS_EOF_${crypto.randomUUID().slice(0, 16)}`
    const cmd = `mkdir -p "$(dirname ${quoted})" && base64 -d << '${eof}' > ${quoted}\n${encoded}\n${eof}`
    const result = await this.execute(cmd)
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || `Failed to write file: ${path}`)
    }
  }

  async removeFile(path: string): Promise<void> {
    const result = await this.execute(`rm ${shellQuote(path)}`)
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || `Failed to remove file: ${path}`)
    }
  }

  async statFile(path: string): Promise<FileInfo> {
    const quoted = shellQuote(path)
    const result = await this.execute(
      `test -e ${quoted} || exit 1; test -d ${quoted} && printf 'd\\n' || printf 'f\\n'; stat -c '%s' ${quoted} 2>/dev/null || stat -f '%z' ${quoted} 2>/dev/null || wc -c < ${quoted} 2>/dev/null || echo 0`
    )
    if (result.exitCode !== 0) {
      throw new Error(`Path does not exist: ${path}`)
    }
    const lines = result.stdout.trim().split('\n')
    const isDir = lines[0] === 'd'
    const rawSize = parseInt(lines[1] ?? '', 10)
    const name = path.split('/').filter(Boolean).pop() ?? path
    return Number.isNaN(rawSize) ? { name, isDir } : { name, isDir, size: rawSize }
  }

  async listFiles(path: string): Promise<FileInfo[]> {
    const result = await this.execute(`ls -1aF ${shellQuote(path)}`)
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || `Failed to list directory: ${path}`)
    }

    const entries: FileInfo[] = []
    for (const raw of result.stdout.split('\n')) {
      const line = raw.replace(/\r$/, '')
      if (!line || line === '.' || line === '..' || line === './' || line === '../') {
        continue
      }
      const isDir = line.endsWith('/')
      const name = line.replace(/[/@*=|]$/, '')
      if (name) {
        entries.push({ name, isDir })
      }
    }
    return entries
  }
}
