import { Agent } from '../../agent/agent.js'
import type { Model } from '../../models/model.js'
import type { Tool } from '../tool.js'

type ParentWithRegistry = {
  toolRegistry?: unknown
  model?: unknown
  systemPrompt?: unknown
}

type RegistryLike = {
  getByName?: (name: string) => Tool | undefined
  values?: () => Tool[]
  registry?: Record<string, Tool>
}

function toCamelCaseKey(key: string): string {
  return key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase())
}

function normalizeModelSettings(modelSettings?: Record<string, unknown>): Record<string, unknown> {
  if (modelSettings == null) {
    return {}
  }

  const normalized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(modelSettings)) {
    normalized[toCamelCaseKey(key)] = value
  }
  return normalized
}

function getRegistry(parentAgent: unknown): RegistryLike | undefined {
  if (parentAgent instanceof Agent) {
    return parentAgent.toolRegistry as unknown as RegistryLike
  }

  if (typeof parentAgent !== 'object' || parentAgent === null) {
    return undefined
  }

  const maybe = (parentAgent as ParentWithRegistry).toolRegistry
  if (typeof maybe === 'object' && maybe !== null) {
    return maybe as RegistryLike
  }

  return undefined
}

function getToolByNameFromRegistry(registry: RegistryLike, name: string): Tool | undefined {
  if (typeof registry.getByName === 'function') {
    return registry.getByName(name)
  }

  if (typeof registry.values === 'function') {
    const values = registry.values()
    return values.find((tool) => tool.name === name)
  }

  if (typeof registry.registry === 'object' && registry.registry !== null) {
    return registry.registry[name]
  }

  return undefined
}

export function getParentModel(parentAgent: unknown): Model | undefined {
  if (parentAgent instanceof Agent) {
    return parentAgent.model
  }

  if (typeof parentAgent !== 'object' || parentAgent === null) {
    return undefined
  }

  const maybe = (parentAgent as ParentWithRegistry).model
  if (maybe instanceof Object) {
    return maybe as Model
  }

  return undefined
}

export function getParentSystemPrompt(parentAgent: unknown): string | undefined {
  if (parentAgent instanceof Agent && typeof parentAgent.systemPrompt === 'string') {
    return parentAgent.systemPrompt
  }

  if (typeof parentAgent !== 'object' || parentAgent === null) {
    return undefined
  }

  const maybe = (parentAgent as ParentWithRegistry).systemPrompt
  return typeof maybe === 'string' ? maybe : undefined
}

export function getParentTools(parentAgent: unknown): Tool[] {
  const registry = getRegistry(parentAgent)
  if (registry == null) {
    return []
  }

  if (typeof registry.values === 'function') {
    return registry.values()
  }

  if (typeof registry.registry === 'object' && registry.registry !== null) {
    return Object.values(registry.registry)
  }

  return []
}

export function resolveParentTools(parentAgent: unknown, requestedToolNames?: string[]): Tool[] {
  const registry = getRegistry(parentAgent)
  if (registry == null) {
    return []
  }

  if (requestedToolNames == null) {
    return getParentTools(parentAgent)
  }

  const tools: Tool[] = []
  for (const toolName of requestedToolNames) {
    const tool = getToolByNameFromRegistry(registry, toolName)
    if (tool != null) {
      tools.push(tool)
    } else {
      console.warn(`Tool '${toolName}' not found in parent agent tool registry`)
    }
  }

  return tools
}

async function createBedrockModel(modelSettings: Record<string, unknown>): Promise<Model> {
  const sdk = await import('../../models/bedrock.js')
  return new sdk.BedrockModel(modelSettings)
}

async function createAnthropicModel(modelSettings: Record<string, unknown>): Promise<Model> {
  const sdk = await import('../../models/anthropic.js')
  return new sdk.AnthropicModel(modelSettings)
}

async function createOpenAiModel(modelSettings: Record<string, unknown>): Promise<Model> {
  const sdk = await import('../../models/openai.js')
  return new sdk.OpenAIModel(modelSettings)
}

export async function createModelFromConfig(
  modelProvider: string | undefined,
  modelSettings: Record<string, unknown> | undefined,
  fallbackModel?: Model
): Promise<Model | undefined> {
  const normalizedSettings = normalizeModelSettings(modelSettings)
  const hasModelSettings = Object.keys(normalizedSettings).length > 0

  if (modelProvider == null && !hasModelSettings) {
    return fallbackModel
  }

  const provider = (modelProvider ?? 'bedrock').toLowerCase()

  try {
    switch (provider) {
      case 'bedrock':
        return await createBedrockModel(normalizedSettings)
      case 'anthropic':
        return await createAnthropicModel(normalizedSettings)
      case 'openai':
        return await createOpenAiModel(normalizedSettings)
      default:
        throw new Error(`Unsupported model provider: ${modelProvider}`)
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Unable to initialize model provider '${provider}': ${reason}`)
  }
}

export function isAgentInstance(value: unknown): value is Agent {
  return value instanceof Agent
}
