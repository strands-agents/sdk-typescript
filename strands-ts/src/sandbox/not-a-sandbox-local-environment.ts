/**
 * Local sandbox implementation using native Node.js APIs.
 *
 * Executes commands and code on the local machine using Node.js child processes
 * and native filesystem operations. This is the default sandbox used when
 * no explicit sandbox is configured.
 */

import { spawn } from 'child_process'
import { readFile, writeFile, unlink, mkdir, readdir, stat } from 'fs/promises'
import { join, dirname, basename, isAbsolute } from 'path'
import type { ExecuteOptions } from './base.js'
import { Sandbox } from './base.js'
import { LANGUAGE_PATTERN } from './constants.js'
import { streamProcess } from './stream-process.js'
import type { ExecutionResult, FileInfo, StreamChunk } from './types.js'

/**
 * Default execution environment — runs on the local host without isolation.
 *
 * Uses `child_process.spawn` for command and code execution, and `fs/promises`
 * for all file operations. This is NOT a sandbox — it runs with the full
 * permissions of the host process. Used internally as the default when no
 * sandbox is configured.
 */
export class NotASandboxLocalEnvironment extends Sandbox {
  readonly workingDir: string

  constructor() {
    super()
    this.workingDir = process.cwd()
  }

  private _resolvePath(path: string): string {
    if (isAbsolute(path)) return path
    return join(this.workingDir, path)
  }

  async *executeStreaming(
    command: string,
    options?: ExecuteOptions
  ): AsyncGenerator<StreamChunk | ExecutionResult, void, undefined> {
    const cwd = options?.cwd ?? this.workingDir
    const proc = spawn(command, [], { cwd, shell: true })
    yield* streamProcess(proc, { timeout: options?.timeout, signal: options?.signal })
  }

  async *executeCodeStreaming(
    code: string,
    language: string,
    options?: ExecuteOptions
  ): AsyncGenerator<StreamChunk | ExecutionResult, void, undefined> {
    if (!LANGUAGE_PATTERN.test(language)) {
      throw new Error(`language parameter contains unsafe characters: ${language}`)
    }

    const cwd = options?.cwd ?? this.workingDir
    const proc = spawn(language, [], { cwd, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
    proc.stdin!.end(code)
    yield* streamProcess(proc, {
      timeout: options?.timeout,
      signal: options?.signal,
      enoentMessage: `Language interpreter not found: ${language}`,
    })
  }

  async readFile(path: string): Promise<Uint8Array> {
    return readFile(this._resolvePath(path))
  }

  async writeFile(path: string, content: Uint8Array): Promise<void> {
    const fullPath = this._resolvePath(path)
    await mkdir(dirname(fullPath), { recursive: true })
    await writeFile(fullPath, content)
  }

  async removeFile(path: string): Promise<void> {
    await unlink(this._resolvePath(path))
  }

  async listFiles(path: string): Promise<FileInfo[]> {
    const fullPath = this._resolvePath(path)
    const entries = await readdir(fullPath, { withFileTypes: true })
    const results: FileInfo[] = []

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      try {
        const entryStat = await stat(join(fullPath, entry.name))
        results.push({
          name: entry.name,
          isDir: entryStat.isDirectory(),
          size: entryStat.size,
        })
      } catch {
        results.push({ name: entry.name })
      }
    }

    return results
  }

  async statFile(path: string): Promise<FileInfo> {
    const fullPath = this._resolvePath(path)
    const s = await stat(fullPath)
    return {
      name: basename(fullPath),
      isDir: s.isDirectory(),
      size: s.size,
    }
  }
}
