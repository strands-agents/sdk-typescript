/**
 * Sandbox abstraction for agent code execution environments.
 *
 * Provides the Sandbox interface that decouples tool logic from where code runs.
 * Tools that need to execute code or access a filesystem receive a Sandbox
 * instead of managing their own execution.
 *
 * Class hierarchy:
 * - `Sandbox` (abstract, all operations abstract + convenience helpers)
 *   - `HostSandbox` — native Node.js methods for host execution (default)
 *   - `NoOpSandbox` — no-op implementation that disables all functionality
 */

export { Sandbox } from './base.js'
export type { ExecutionResult, ExecuteOptions, FileInfo, OutputFile, StreamChunk, StreamType } from './base.js'
export { HostSandbox } from './host.js'
export type { HostSandboxConfig } from './host.js'
export { NoOpSandbox } from './noop.js'
