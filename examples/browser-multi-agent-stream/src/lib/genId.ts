export function genId(): string {
  return `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}
