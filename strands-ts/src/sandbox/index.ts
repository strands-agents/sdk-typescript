/**
 * Sandbox abstraction for agent code execution environments.
 *
 * This module provides the {@link Sandbox} interface that decouples tool logic
 * from where code runs. Tools that need to execute code or access a filesystem
 * receive a Sandbox instead of managing their own execution, enabling
 * portability across local and cloud environments.
 */

export { Sandbox, type ExecuteOptions } from './base.js'
export { ShellSandbox } from './shell.js'
export { RemoteSandbox, type RemoteSandboxOptions } from './remote.js'
export { DockerSandbox, type DockerSandboxOptions } from './docker.js'
export type { StreamType, StreamChunk, FileInfo, OutputFile, ExecutionResult, SandboxSnapshot } from './types.js'
