/**
 * State structure for file editor history storage.
 * File history is stored in agent state under the 'fileEditorHistory' key.
 */
export interface FileEditorState {
  /**
   * Map of file paths to their edit history.
   * Each file stores an array of previous contents (up to 10 versions).
   */
  fileEditorHistory: Record<string, string[]>
}

/**
 * Configuration options for the file editor tool.
 */
export interface FileEditorOptions {
  /**
   * Maximum file size in bytes that can be read (default: 1048576 / 1MB).
   */
  maxFileSize?: number

  /**
   * Maximum number of history versions to keep per file (default: 10).
   */
  maxHistorySize?: number
}

/**
 * Input parameters for view operation.
 */
export interface ViewInput {
  command: 'view'
  path: string
  view_range?: [number, number]
}

/**
 * Input parameters for create operation.
 */
export interface CreateInput {
  command: 'create'
  path: string
  file_text: string
}

/**
 * Input parameters for str_replace operation.
 */
export interface StrReplaceInput {
  command: 'str_replace'
  path: string
  old_str: string
  new_str?: string
}

/**
 * Input parameters for insert operation.
 */
export interface InsertInput {
  command: 'insert'
  path: string
  insert_line: number
  new_str: string
}

/**
 * Input parameters for undo_edit operation.
 */
export interface UndoEditInput {
  command: 'undo_edit'
  path: string
}

/**
 * Union type of all valid file editor inputs.
 */
export type FileEditorInput = ViewInput | CreateInput | StrReplaceInput | InsertInput | UndoEditInput

/**
 * Interface for pluggable file readers.
 * Allows extending the file editor to support different file types.
 */
export interface IFileReader {
  /**
   * Reads the file content and returns it as a string.
   *
   * @param path - Absolute path to the file
   * @returns File content as a string
   */
  read(path: string): Promise<string>
}
