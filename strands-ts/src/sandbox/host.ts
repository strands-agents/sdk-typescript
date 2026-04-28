import { Buffer } from 'buffer'
/**
 * Host sandbox implementation for host-process execution.
 *
 * Executes commands and code on the local host using Node.js `child_process`
 * and native filesystem operations. Extends `Sandbox` directly — all file and
 * code operations use proper Node.js methods instead of shell commands.
 *
 * This is the default sandbox used when no explicit sandbox is configured.
 */

import { spawn, execSync } from 'node:child_process'
import { readFile, writeFile, unlink, readdir, stat, mkdir } from 'node:fs/promises'
import { resolve, isAbsolute } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
import { logger } from '../logging/logger.js'
import type { ExecutionResult, ExecuteOptions, FileInfo, StreamChunk } from './base.js'
import { Sandbox } from './base.js'

/**
 * Pattern for validating language/interpreter names.
 * Allows alphanumeric characters, dots, hyphens, and underscores.
 */
const LANGUAGE_PATTERN = /^[a-zA-Z0-9._-]+$/

/**
 * Configuration for the HostSandbox.
 */
export interface HostSandboxConfig {
  /**
   * The working directory for command execution.
   * Defaults to the current working directory.
   */
  workingDir?: string
}

/**
 * Execute code and commands on the local host using native Node.js methods.
 *
 * Uses `child_process.spawn` for command execution and native `fs` methods
 * for all file I/O.
 *
 * This sandbox extends `Sandbox` directly — it does **not** inherit from
 * `ShellBasedSandbox`. All operations use proper, safe Node.js methods
 * instead of piping through shell commands.
 *
 * @example
 * ```typescript
 * const sandbox = new HostSandbox({ workingDir: '/tmp/my-sandbox' })
 * const result = await sandbox.execute('echo hello')
 * console.log(result.stdout) // "hello\n"
 * ```
 */
export class HostSandbox extends Sandbox {
  private readonly _workingDir: string

  /**
   * Creates a new HostSandbox.
   *
   * @param config - Configuration options.
   */
  constructor(config?: HostSandboxConfig) {
    super()
    this._workingDir = config?.workingDir ?? process.cwd()
  }

  /**
   * The working directory for this sandbox.
   */
  get workingDir(): string {
    return this._workingDir
  }

  private _resolvePath(path: string): string {
    if (isAbsolute(path)) {
      return path
    }
    return resolve(this._workingDir, path)
  }

  private _ensureDir(dirPath: string): void {
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true })
    }
  }

  async *executeStreaming(
    command: string,
    options?: ExecuteOptions
  ): AsyncGenerator<StreamChunk | ExecutionResult, void, undefined> {
    const effectiveCwd = options?.cwd ?? this._workingDir
    logger.debug(`command=<${command}>, timeout=<${options?.timeout}>, cwd=<${effectiveCwd}> | executing local command`)

    this._ensureDir(effectiveCwd)

    const { stdout, stderr, exitCode } = await this._spawnAndCollect(command, effectiveCwd, options?.timeout, true)

    for (const chunk of stdout) {
      yield { data: chunk, streamType: 'stdout' }
    }
    for (const chunk of stderr) {
      yield { data: chunk, streamType: 'stderr' }
    }

    yield {
      exitCode,
      stdout: stdout.join(''),
      stderr: stderr.join(''),
      outputFiles: [],
    }
  }

  async *executeCodeStreaming(
    code: string,
    language: string,
    options?: ExecuteOptions
  ): AsyncGenerator<StreamChunk | ExecutionResult, void, undefined> {
    if (!LANGUAGE_PATTERN.test(language)) {
      throw new Error(`language parameter contains unsafe characters: ${language}`)
    }

    const effectiveCwd = options?.cwd ?? this._workingDir
    logger.debug(
      `language=<${language}>, timeout=<${options?.timeout}>, cwd=<${effectiveCwd}> | executing code locally`
    )

    this._ensureDir(effectiveCwd)

    // Check if interpreter exists
    try {
      execSync(`which ${language}`, { stdio: 'pipe' })
    } catch {
      yield {
        exitCode: 127,
        stdout: '',
        stderr: `Language interpreter not found: ${language}`,
        outputFiles: [],
      }
      return
    }

    const { stdout, stderr, exitCode } = await this._spawnAndCollect(
      `${language} -c ${this._shellQuote(code)}`,
      effectiveCwd,
      options?.timeout,
      true
    )

    for (const chunk of stdout) {
      yield { data: chunk, streamType: 'stdout' }
    }
    for (const chunk of stderr) {
      yield { data: chunk, streamType: 'stderr' }
    }

    yield {
      exitCode,
      stdout: stdout.join(''),
      stderr: stderr.join(''),
      outputFiles: [],
    }
  }

  async readFile(path: string): Promise<Uint8Array> {
    const fullPath = this._resolvePath(path)
    return new Uint8Array(await readFile(fullPath))
  }

  async writeFile(path: string, content: Uint8Array): Promise<void> {
    const fullPath = this._resolvePath(path)
    const dir = resolve(fullPath, '..')
    await mkdir(dir, { recursive: true })
    await writeFile(fullPath, content)
  }

  async removeFile(path: string): Promise<void> {
    const fullPath = this._resolvePath(path)
    await unlink(fullPath)
  }

  async listFiles(path: string): Promise<FileInfo[]> {
    const fullPath = this._resolvePath(path)
    const entries = await readdir(fullPath)
    const results: FileInfo[] = []

    for (const name of entries.sort()) {
      const entryPath = resolve(fullPath, name)
      try {
        const s = await stat(entryPath)
        results.push({
          name,
          isDir: s.isDirectory(),
          size: s.size,
        })
      } catch {
        // Broken symlink or stat failure — include with defaults
        results.push({ name })
      }
    }

    return results
  }

  private _shellQuote(s: string): string {
    return `'${s.replace(/'/g, "'\\''")}'`
  }

  private async _spawnAndCollect(
    command: string,
    cwd: string,
    timeout?: number,
    shell = true
  ): Promise<{ stdout: string[]; stderr: string[]; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, { cwd, shell, stdio: 'pipe' })

      const stdoutChunks: string[] = []
      const stderrChunks: string[] = []
      let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined

      if (timeout) {
        timeoutId = globalThis.setTimeout(() => {
          proc.kill('SIGKILL')
          reject(new Error(`Command timed out after ${timeout} seconds`))
        }, timeout * 1000)
      }

      proc.stdout.on('data', (data: Buffer) => {
        stdoutChunks.push(data.toString())
      })

      proc.stderr.on('data', (data: Buffer) => {
        stderrChunks.push(data.toString())
      })

      proc.on('close', (code) => {
        if (timeoutId) globalThis.clearTimeout(timeoutId)
        resolve({
          stdout: stdoutChunks,
          stderr: stderrChunks,
          exitCode: code ?? 0,
        })
      })

      proc.on('error', (err) => {
        if (timeoutId) globalThis.clearTimeout(timeoutId)
        reject(err)
      })
    })
  }
}
