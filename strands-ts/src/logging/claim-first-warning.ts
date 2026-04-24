const warned = new Set<string>()

/**
 * Returns true the first time a given message is seen, false thereafter.
 * Used to emit a warning at most once per unique message per process.
 */
export function claimFirstWarning(msg: string): boolean {
  if (warned.has(msg)) return false
  warned.add(msg)
  return true
}
