/**
 * State structure for notebook storage.
 * This should be stored in the ToolContext.invocationState by the caller.
 */
export interface NotebookState {
  /**
   * Map of notebook names to their content.
   * Each notebook stores plain text content with newline-separated lines.
   */
  notebooks: Record<string, string>
}

/**
 * Input parameters for create operation.
 */
export interface CreateInput {
  mode: 'create'
  /** Name of the notebook to create */
  name?: string
  /** Optional initial content for the notebook */
  newStr?: string
}

/**
 * Input parameters for list operation.
 */
export interface ListInput {
  mode: 'list'
}

/**
 * Input parameters for read operation.
 */
export interface ReadInput {
  mode: 'read'
  /** Name of the notebook to read */
  name?: string
  /** Optional line range [start, end] to read. Supports negative indices. */
  readRange?: [number, number]
}

/**
 * Input parameters for write operation (string replacement).
 */
export interface WriteReplaceInput {
  mode: 'write'
  /** Name of the notebook to write to */
  name?: string
  /** String to find and replace */
  oldStr: string
  /** Replacement string */
  newStr: string
}

/**
 * Input parameters for write operation (line insertion).
 */
export interface WriteInsertInput {
  mode: 'write'
  /** Name of the notebook to write to */
  name?: string
  /** Line number (supports negative indices) or search text for insertion point */
  insertLine: string | number
  /** Text to insert */
  newStr: string
}

/**
 * Input parameters for clear operation.
 */
export interface ClearInput {
  mode: 'clear'
  /** Name of the notebook to clear */
  name?: string
}

/**
 * Union type of all valid notebook inputs.
 */
export type NotebookInput = CreateInput | ListInput | ReadInput | WriteReplaceInput | WriteInsertInput | ClearInput
