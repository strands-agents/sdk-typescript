import type { Plugin } from '../../plugins/plugin.js'
import type { Tool } from '../../tools/tool.js'
import type { LocalAgent } from '../../types/agent.js'
import type { Model } from '../../models/model.js'
import { AfterToolCallEvent } from '../../hooks/events.js'
import { TextBlock, JsonBlock, ToolResultBlock, Message } from '../../types/messages.js'
import type { ToolResultContent } from '../../types/messages.js'
import { ImageBlock, VideoBlock, DocumentBlock } from '../../types/media.js'
import { tool } from '../../tools/tool-factory.js'
import { z } from 'zod'
import { logger } from '../../logging/logger.js'
import type { Storage } from './storage.js'

const CHARS_PER_TOKEN = 4
const DEFAULT_MAX_RESULT_TOKENS = 2_500
const DEFAULT_PREVIEW_TOKENS = 1_000
const RETRIEVAL_TOOL_NAME = 'retrieve_offloaded_content'

function slicePreview(text: string, previewTokens: number): string {
  const maxChars = previewTokens * CHARS_PER_TOKEN
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars)
}

function getBytes(block: ToolResultContent): Uint8Array | undefined {
  if (block instanceof ImageBlock && block.source.type === 'imageSourceBytes') {
    return block.source.bytes
  }
  if (block instanceof VideoBlock && block.source.type === 'videoSourceBytes') {
    return block.source.bytes
  }
  if (block instanceof DocumentBlock) {
    if (block.source.type === 'documentSourceBytes') return block.source.bytes
    if (block.source.type === 'documentSourceText') return new TextEncoder().encode(block.source.text)
  }
  return undefined
}

export interface ContextOffloaderConfig {
  storage: Storage
  maxResultTokens?: number
  previewTokens?: number
  includeRetrievalTool?: boolean
}

export class ContextOffloader implements Plugin {
  readonly name = 'strands:context-offloader'

  private readonly _storage: Storage
  private readonly _maxResultTokens: number
  private readonly _previewTokens: number
  private readonly _includeRetrievalTool: boolean
  private _retrievalTool: Tool | undefined

  constructor(config: ContextOffloaderConfig) {
    const maxResultTokens = config.maxResultTokens ?? DEFAULT_MAX_RESULT_TOKENS
    const previewTokens = config.previewTokens ?? DEFAULT_PREVIEW_TOKENS

    if (maxResultTokens <= 0) throw new Error('maxResultTokens must be positive')
    if (previewTokens < 0) throw new Error('previewTokens must be non-negative')
    if (previewTokens >= maxResultTokens) throw new Error('previewTokens must be less than maxResultTokens')

    this._storage = config.storage
    this._maxResultTokens = maxResultTokens
    this._previewTokens = previewTokens
    this._includeRetrievalTool = config.includeRetrievalTool ?? true
  }

  initAgent(agent: LocalAgent): void {
    agent.addHook(AfterToolCallEvent, (event) => this._handleToolResult(event))
  }

  getTools(): Tool[] {
    if (!this._includeRetrievalTool) return []
    if (!this._retrievalTool) {
      this._retrievalTool = this._createRetrievalTool()
    }
    return [this._retrievalTool]
  }

  private _createRetrievalTool(): Tool {
    const storage = this._storage
    return tool({
      name: RETRIEVAL_TOOL_NAME,
      description:
        'Retrieve offloaded content by reference. Use this tool when you see a placeholder with a reference (ref: ...) and need the full content. Only use this as a fallback if the data cannot be accessed using your existing tools.',
      inputSchema: z.object({
        reference: z.string().describe('The reference string from the offload placeholder.'),
      }),
      callback: async (input) => {
        let result: { content: Uint8Array; contentType: string }
        try {
          result = await storage.retrieve(input.reference)
        } catch {
          return `Error: reference not found: ${input.reference}`
        }

        if (result.contentType.startsWith('text/')) {
          return new TextDecoder().decode(result.content)
        }

        if (result.contentType === 'application/json') {
          try {
            return JSON.parse(new TextDecoder().decode(result.content))
          } catch {
            return new TextDecoder().decode(result.content)
          }
        }

        if (result.contentType.startsWith('image/')) {
          const imgFormat = result.contentType.split('/').pop()!
          return new ImageBlock({
            format: imgFormat as import('../../types/media.js').ImageFormat,
            source: { bytes: result.content },
          })
        }

        if (result.contentType.startsWith('application/')) {
          const docFormat = result.contentType.split('/').pop()!
          return new DocumentBlock({
            format: docFormat as import('../../types/media.js').DocumentFormat,
            name: input.reference,
            source: { bytes: result.content },
          })
        }

        return new TextDecoder('utf-8', { fatal: false }).decode(result.content)
      },
    })
  }

  private async _handleToolResult(event: AfterToolCallEvent): Promise<void> {
    if (event.result.status === 'error') return

    if (this._includeRetrievalTool && event.toolUse.name === RETRIEVAL_TOOL_NAME) return

    const content = event.result.content
    const toolUseId = event.result.toolUseId

    const toolResultMessage = new Message({ role: 'user', content: [event.result] })
    // Cast: LocalAgent doesn't expose model yet. Tracked in https://github.com/strands-agents/sdk-typescript/pull/938
    // Falls back to 0 (no offloading) if model is unavailable — only affects non-Agent LocalAgent implementations.
    const model = (event.agent as unknown as { model?: Model }).model
    const tokenCount = model ? await model.countTokens([toolResultMessage]) : 0

    if (tokenCount <= this._maxResultTokens) return

    const textPreviewParts: string[] = []
    for (const block of content) {
      if (block instanceof TextBlock && block.text) {
        textPreviewParts.push(block.text)
      } else if (block instanceof JsonBlock) {
        textPreviewParts.push(JSON.stringify(block.json, null, 2))
      }
    }
    const fullText = textPreviewParts.join('\n')

    const references: Array<{ ref: string; contentType: string; description: string }> = []
    try {
      for (let i = 0; i < content.length; i++) {
        const block = content[i]
        const key = `${toolUseId}_${i}`

        if (block instanceof TextBlock && block.text) {
          const ref = await this._storage.store(key, new TextEncoder().encode(block.text), 'text/plain')
          references.push({
            ref,
            contentType: 'text/plain',
            description: `text, ${block.text.length.toLocaleString()} chars`,
          })
        } else if (block instanceof JsonBlock) {
          const jsonStr = JSON.stringify(block.json, null, 2)
          const jsonBytes = new TextEncoder().encode(jsonStr)
          const ref = await this._storage.store(key, jsonBytes, 'application/json')
          references.push({
            ref,
            contentType: 'application/json',
            description: `json, ${jsonBytes.length.toLocaleString()} bytes`,
          })
        } else if (block instanceof ImageBlock) {
          const imgBytes = getBytes(block)
          if (imgBytes) {
            const ref = await this._storage.store(key, imgBytes, `image/${block.format}`)
            references.push({
              ref,
              contentType: `image/${block.format}`,
              description: `image/${block.format}, ${imgBytes.length.toLocaleString()} bytes`,
            })
          } else {
            references.push({
              ref: '',
              contentType: `image/${block.format}`,
              description: `image/${block.format}, 0 bytes`,
            })
          }
        } else if (block instanceof VideoBlock) {
          const vidBytes = getBytes(block)
          if (vidBytes) {
            const ref = await this._storage.store(key, vidBytes, `video/${block.format}`)
            references.push({
              ref,
              contentType: `video/${block.format}`,
              description: `video/${block.format}, ${vidBytes.length.toLocaleString()} bytes`,
            })
          } else {
            references.push({
              ref: '',
              contentType: `video/${block.format}`,
              description: `video/${block.format}, 0 bytes`,
            })
          }
        } else if (block instanceof DocumentBlock) {
          const docBytes = getBytes(block)
          if (docBytes) {
            const ref = await this._storage.store(key, docBytes, `application/${block.format}`)
            references.push({
              ref,
              contentType: `application/${block.format}`,
              description: `${block.name}, ${docBytes.length.toLocaleString()} bytes`,
            })
          } else {
            references.push({
              ref: '',
              contentType: `application/${block.format}`,
              description: `${block.name}, 0 bytes`,
            })
          }
        } else {
          references.push({ ref: '', contentType: 'unknown', description: 'unknown block type' })
        }
      }
    } catch (err) {
      logger.warn(`tool_use_id=<${toolUseId}> | failed to offload tool result, keeping original`, err)
      return
    }

    logger.debug(
      `tool_use_id=<${toolUseId}>, blocks=<${references.length}>, tokens=<${tokenCount}> | tool result offloaded`
    )

    const preview = fullText ? slicePreview(fullText, this._previewTokens) : ''
    const refLines = references
      .filter((r) => r.ref)
      .map((r) => `  ${r.ref} (${r.description})`)
      .join('\n')

    let guidance =
      'Tool result was offloaded to external storage due to size.\n' +
      'Use the preview below to answer if possible.\n' +
      'Use your available tools to selectively access the data you need.'
    if (this._includeRetrievalTool) {
      guidance += '\nYou can also use retrieve_offloaded_content with a reference to get the full content.'
    }

    const previewText =
      `[Offloaded: ${content.length} blocks, ~${tokenCount.toLocaleString()} tokens]\n` +
      `${guidance}\n\n` +
      `${preview}\n\n` +
      `[Stored references:]\n${refLines}`

    const newContent: ToolResultContent[] = [new TextBlock(previewText)]

    for (let i = 0; i < content.length; i++) {
      const block = content[i]
      const ref = references[i]?.ref ?? ''

      if (block instanceof TextBlock || block instanceof JsonBlock) {
        continue
      } else if (block instanceof ImageBlock) {
        const imgBytes = getBytes(block)
        let placeholder = `[image: ${block.format}, ${imgBytes ? imgBytes.length : 0} bytes`
        if (ref) placeholder += ` | ref: ${ref}`
        placeholder += ']'
        newContent.push(new TextBlock(placeholder))
      } else if (block instanceof VideoBlock) {
        const vidBytes = getBytes(block)
        let placeholder = `[video: ${block.format}, ${vidBytes ? vidBytes.length : 0} bytes`
        if (ref) placeholder += ` | ref: ${ref}`
        placeholder += ']'
        newContent.push(new TextBlock(placeholder))
      } else if (block instanceof DocumentBlock) {
        const docBytes = getBytes(block)
        let placeholder = `[document: ${block.format}, ${block.name}, ${docBytes ? docBytes.length : 0} bytes`
        if (ref) placeholder += ` | ref: ${ref}`
        placeholder += ']'
        newContent.push(new TextBlock(placeholder))
      }
    }

    event.result = new ToolResultBlock({
      toolUseId: event.result.toolUseId,
      status: event.result.status,
      content: newContent,
    })
  }
}
