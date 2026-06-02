/**
 * Re-exports from the canonical ContextOffloader location.
 * The ContextManager composes ContextOffloader as its tool-result-cache sub-plugin.
 */
export { ContextOffloader, type ContextOffloaderConfig } from '../../vended-plugins/context-offloader/plugin.js'
export type { Storage } from '../../vended-plugins/context-offloader/storage.js'
export { InMemoryStorage, FileStorage, S3Storage } from '../../vended-plugins/context-offloader/storage.js'
