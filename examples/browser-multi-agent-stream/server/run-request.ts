import type { StructuredOutputSchemaId } from './structured-output.js'

export interface RunRequestAgent {
  name: string
  systemPrompt: string
  tools?: string[]
}

export interface RunRequest {
  prompt: string
  mode: 'single' | 'swarm' | 'graph'
  agents: RunRequestAgent[]
  modelProfile?: string
  modelId?: string
  presetKey?: string
  sessionId?: string
  singleAgent?: string
  entryPoint?: string
  maxHandoffs?: number
  edges?: Array<{ from: string; to: string }>
  entryPoints?: string[]
  structuredOutputSchema?: StructuredOutputSchemaId
}

interface ValidateRunRequestOptions {
  maxAgents: number
  maxSystemPromptChars: number
  maxHandoffs: number
  maxEdges: number
  sessionIdMaxChars: number
  validStructuredSchemaIds: StructuredOutputSchemaId[]
}

export function validateAndClampRunRequest(
  body: unknown,
  options: ValidateRunRequestOptions
): RunRequest | null {
  if (body == null || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const prompt = typeof b.prompt === 'string' ? b.prompt.trim() : ''
  if (!prompt) return null
  const mode = b.mode === 'single' ? 'single' : b.mode === 'graph' ? 'graph' : 'swarm'
  const rawAgents = Array.isArray(b.agents) ? b.agents : []
  const agents: RunRequestAgent[] = []
  const seenNames = new Set<string>()
  for (let i = 0; i < Math.min(rawAgents.length, options.maxAgents); i++) {
    const a = rawAgents[i]
    if (a == null || typeof a !== 'object') continue
    const name = typeof (a as RunRequestAgent).name === 'string' ? (a as RunRequestAgent).name.trim() : `agent_${i}`
    if (!name || seenNames.has(name)) continue
    seenNames.add(name)
    let systemPrompt =
      typeof (a as RunRequestAgent).systemPrompt === 'string' ? (a as RunRequestAgent).systemPrompt : ''
    if (systemPrompt.length > options.maxSystemPromptChars) {
      systemPrompt = systemPrompt.slice(0, options.maxSystemPromptChars)
    }
    const rawTools = (a as RunRequestAgent).tools
    const tools = Array.isArray(rawTools)
      ? rawTools.filter((t): t is string => typeof t === 'string').slice(0, 20)
      : undefined
    agents.push({ name, systemPrompt, tools })
  }
  if (agents.length < 1) return null

  const singleAgent =
    typeof b.singleAgent === 'string' && agents.some((x) => x.name === b.singleAgent)
      ? (b.singleAgent as string)
      : agents[0]!.name
  const entryPoint =
    typeof b.entryPoint === 'string' && agents.some((x) => x.name === b.entryPoint)
      ? (b.entryPoint as string)
      : agents[0]!.name
  const maxHandoffs =
    typeof b.maxHandoffs === 'number'
      ? Math.min(options.maxHandoffs, Math.max(1, Math.floor(b.maxHandoffs)))
      : 3
  const rawEdges = Array.isArray(b.edges) ? b.edges : []
  const edges: Array<{ from: string; to: string }> = []
  const nodeIds = new Set(agents.map((x) => x.name))
  for (let i = 0; i < Math.min(rawEdges.length, options.maxEdges); i++) {
    const e = rawEdges[i]
    if (e == null || typeof e !== 'object') continue
    const from = typeof (e as { from: string }).from === 'string' ? (e as { from: string }).from : ''
    const to = typeof (e as { to: string }).to === 'string' ? (e as { to: string }).to : ''
    if (nodeIds.has(from) && nodeIds.has(to)) edges.push({ from, to })
  }
  const entryPoints = Array.isArray(b.entryPoints) ? (b.entryPoints as string[]).filter((id) => nodeIds.has(id)) : []
  const structuredOutputSchemaRaw = b.structuredOutputSchema
  const structuredOutputSchema =
    typeof structuredOutputSchemaRaw === 'string' &&
    (options.validStructuredSchemaIds as string[]).includes(structuredOutputSchemaRaw)
      ? (structuredOutputSchemaRaw as StructuredOutputSchemaId)
      : undefined
  const presetKey = sanitizePresetKey(b.presetKey)
  const sessionId = sanitizeSessionId(b.sessionId, options.sessionIdMaxChars)
  const modelProfileRaw = typeof b.modelProfile === 'string' ? b.modelProfile.trim() : ''
  const modelProfile = modelProfileRaw === '' ? undefined : modelProfileRaw
  const modelIdRaw = typeof b.modelId === 'string' ? b.modelId.trim() : ''
  const modelId = modelIdRaw === '' ? undefined : modelIdRaw.slice(0, 160)

  return {
    prompt,
    mode,
    agents,
    modelProfile,
    modelId,
    presetKey,
    sessionId,
    singleAgent,
    entryPoint,
    maxHandoffs,
    edges,
    entryPoints,
    structuredOutputSchema,
  }
}

function sanitizeSessionId(raw: unknown, maxChars: number): string | undefined {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  const normalized = trimmed.slice(0, maxChars).replace(/[\\/]/g, '_')
  return normalized === '' ? undefined : normalized
}

function sanitizePresetKey(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  const normalized = trimmed.slice(0, 64).replace(/[^a-zA-Z0-9_-]/g, '')
  return normalized === '' ? undefined : normalized
}
