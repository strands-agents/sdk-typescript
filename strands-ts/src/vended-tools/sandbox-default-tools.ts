import type { Tool } from '../tools/tool.js'
import { fileEditor } from './file-editor/file-editor.js'
import { exec } from './exec/exec.js'
import { codeInterpreter } from './code-interpreter/code-interpreter.js'

export const SANDBOX_DEFAULT_TOOLS: Tool[] = [fileEditor, exec, codeInterpreter]
