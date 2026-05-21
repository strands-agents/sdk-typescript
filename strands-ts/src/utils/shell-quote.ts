/**
 * Shell-escape a string for safe inclusion in a shell command.
 *
 * Wraps the value in single quotes and escapes any embedded single quotes
 * using the '\'' pattern. Single quotes disable all shell expansion
 * (variables, backticks, globbing), making this safe against injection.
 */
export function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'"
}
