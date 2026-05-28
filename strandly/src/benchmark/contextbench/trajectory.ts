import type { Message } from '../../../../strands-ts/src/types/messages.js'

export interface TrajectoryEntry {
  file: string
  content?: string
  startLine?: number
  endLine?: number
}

export function extractTrajectory(messages: Message[], repoDir?: string): TrajectoryEntry[] {
  const entries: TrajectoryEntry[] = []
  const seen = new Set<string>()

  for (const msg of messages) {
    if (msg.role !== 'assistant') continue

    for (const block of msg.content) {
      if (block.type !== 'toolUseBlock') continue

      const paths = extractFilePathsFromToolCall(block.name, block.input as Record<string, unknown>)
      for (const filePath of paths) {
        const relative = toRelativePath(filePath, repoDir)
        if (relative && !seen.has(relative)) {
          seen.add(relative)
          entries.push({ file: relative })
        }
      }
    }
  }

  return entries
}

export function trajectoryToFileList(entries: TrajectoryEntry[]): string[] {
  return entries.map((e) => e.file)
}

function toRelativePath(filePath: string, repoDir?: string): string {
  if (!repoDir) return filePath

  const normalized = repoDir.endsWith('/') ? repoDir : repoDir + '/'
  if (filePath.startsWith(normalized)) {
    return filePath.slice(normalized.length)
  }
  if (filePath.startsWith('/')) {
    return filePath
  }
  return filePath
}

// Best-effort extraction — won't catch all patterns (e.g. grep -rn, find -exec, piped commands, quoted paths)
function extractFilePathsFromToolCall(toolName: string, input: Record<string, unknown>): string[] {
  if (toolName === 'file_editor' || toolName === 'fileEditor') {
    const path = (input.path ?? input.file_path ?? input.filePath) as string | undefined
    if (path && (input.command === 'view' || !input.command)) return [path]
  }

  if (toolName === 'bash') {
    const cmd = (input.command ?? input.cmd) as string | undefined
    if (!cmd) return []

    const paths: string[] = []

    const catMatch = cmd.match(/(?:cat|head|tail|less|more)\s+([^\s|;>&]+)/g)
    if (catMatch) {
      for (const m of catMatch) {
        const file = m.replace(/^(?:cat|head|tail|less|more)\s+/, '')
        if (file && !file.startsWith('-')) paths.push(file)
      }
    }

    const sedMatch = cmd.match(/sed\s+.*\s+([^\s|;>&]+\.\w+)/)
    if (sedMatch) paths.push(sedMatch[1]!)

    const pythonCat = cmd.match(/python.*(?:open|read)\s*\(\s*['"]([^'"]+)['"]\s*\)/)
    if (pythonCat) paths.push(pythonCat[1]!)

    return paths
  }

  return []
}
