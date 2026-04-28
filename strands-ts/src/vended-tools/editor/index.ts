/**
 * Sandbox-aware file editor tool for viewing, creating, and editing files.
 *
 * @example
 * ```typescript
 * import { editor } from '@strands-agents/sdk/vended-tools/editor'
 * import { Agent } from '@strands-agents/sdk'
 *
 * const agent = new Agent({ tools: [editor] })
 * await agent.invoke('View the contents of /tmp/example.ts')
 * ```
 */

export { editor } from './editor.js'
export type { EditorToolConfig } from './types.js'
