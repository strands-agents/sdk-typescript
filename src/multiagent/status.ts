/**
 * Execution lifecycle status shared across all multi-agent patterns.
 */
export enum Status {
  /** Execution has not yet started. */
  PENDING = 'PENDING',
  /** Execution is currently in progress. */
  EXECUTING = 'EXECUTING',
  /** Execution finished successfully. */
  COMPLETED = 'COMPLETED',
  /** Execution encountered an error. */
  FAILED = 'FAILED',
  /** Execution was cancelled before or during processing. */
  CANCELLED = 'CANCELLED',
}
