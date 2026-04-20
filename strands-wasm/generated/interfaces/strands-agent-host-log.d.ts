// @generated from wit/agent.wit -- do not edit

declare module 'strands:agent/host-log' {
  /**
   * Emit a structured log entry visible to the host.
   */
  export function log(entry: LogEntry): void;
  /**
   * # Variants
   * 
   * ## `"trace"`
   * 
   * ## `"debug"`
   * 
   * ## `"info"`
   * 
   * ## `"warn"`
   * 
   * ## `"error"`
   */
  export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';
  export interface LogEntry {
    level: LogLevel,
    /**
     * Human-readable message.
     */
    message: string,
    /**
     * Optional JSON blob with structured context (tool name, event
     * kind, JS stack trace on errors, …).
     */
    context?: string,
  }
}
