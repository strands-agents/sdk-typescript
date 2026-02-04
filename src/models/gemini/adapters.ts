/**
 * Adapters for converting between Strands SDK types and Gemini API format.
 *
 * @internal This module is not part of the public API.
 */

import {
  type Content,
  type GenerateContentResponse,
  type Part,
  FinishReason as GeminiFinishReason,
} from '@google/genai'
import type { Message, StopReason, ContentBlock, ReasoningBlock } from '../../types/messages.js'
import type { ModelStreamEvent } from '../streaming.js'
import type { GeminiStreamState } from './types.js'
import { encodeBase64, getMimeType, type ImageBlock, type DocumentBlock } from '../../types/media.js'
import { logger } from '../../logging/logger.js'

/**
 * Mapping of Gemini finish reasons to SDK stop reasons.
 * Only MAX_TOKENS needs explicit mapping; everything else defaults to endTurn.
 * TOOL_USE is handled separately via hasToolCalls flag.
 *
 * @internal
 */
export const FINISH_REASON_MAP: Partial<Record<GeminiFinishReason, StopReason>> = {
  [GeminiFinishReason.MAX_TOKENS]: 'maxTokens',
}

// =============================================================================
// Strands → Gemini
// =============================================================================

/**
 * Formats an array of messages for the Gemini API.
 *
 * @param messages - SDK messages to format
 * @returns Gemini-formatted contents array
 *
 * @internal
 */
export function formatMessages(messages: Message[]): Content[] {
  const contents: Content[] = []

  for (const message of messages) {
    const parts: Part[] = []

    for (const block of message.content) {
      const part = formatContentBlock(block)
      if (part) {
        parts.push(part)
      }
    }

    if (parts.length > 0) {
      contents.push({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts,
      })
    }
  }

  return contents
}

/**
 * Formats a content block to a Gemini Part.
 *
 * @param block - SDK content block
 * @returns Gemini Part or undefined if block type is not supported
 *
 * @internal
 */
function formatContentBlock(block: ContentBlock): Part | undefined {
  switch (block.type) {
    case 'textBlock':
      return { text: block.text }

    case 'imageBlock':
      return formatImageBlock(block)

    case 'reasoningBlock':
      return formatReasoningBlock(block)

    case 'documentBlock':
      return formatDocumentBlock(block)

    default:
      return undefined
  }
}

/**
 * Formats an image block to a Gemini Part.
 *
 * @param block - Image block to format
 * @returns Gemini Part with inline data
 *
 * @internal
 */
function formatImageBlock(block: ImageBlock): Part | undefined {
  const mimeType = getMimeType(block.format) ?? `image/${block.format}`

  switch (block.source.type) {
    case 'imageSourceBytes': {
      // Convert Uint8Array to base64 string
      const binaryString = String.fromCharCode(...block.source.bytes)
      const base64Data = encodeBase64(binaryString)
      return {
        inlineData: {
          data: base64Data,
          mimeType,
        },
      }
    }

    case 'imageSourceUrl':
      // Gemini supports URLs via fileData
      return {
        fileData: {
          fileUri: block.source.url,
          mimeType,
        },
      }

    case 'imageSourceS3Location':
      logger.warn('s3 image sources are not supported by gemini, skipping')
      return undefined

    default:
      return undefined
  }
}

/**
 * Formats a reasoning block to a Gemini Part.
 *
 * @param block - Reasoning block to format
 * @returns Gemini Part with thought flag
 *
 * @internal
 */
function formatReasoningBlock(block: ReasoningBlock): Part | undefined {
  if (!block.text) {
    return undefined
  }

  const part: Part = {
    text: block.text,
    thought: true,
  }

  // Add thought signature if present
  if (block.signature) {
    // Cast to add thoughtSignature as it may not be in the SDK types yet
    ;(part as Part & { thoughtSignature?: Uint8Array }).thoughtSignature = new TextEncoder().encode(block.signature)
  }

  return part
}

/**
 * Formats a document block to a Gemini Part.
 *
 * @param block - Document block to format
 * @returns Gemini Part with inline data
 *
 * @internal
 */
function formatDocumentBlock(block: DocumentBlock): Part | undefined {
  const mimeType = getMimeType(block.format) ?? `application/${block.format}`

  switch (block.source.type) {
    case 'documentSourceBytes': {
      // Convert Uint8Array to base64 string
      const binaryString = String.fromCharCode(...block.source.bytes)
      const base64Data = encodeBase64(binaryString)
      return {
        inlineData: {
          data: base64Data,
          mimeType,
        },
      }
    }

    case 'documentSourceText':
      // Convert text to a text part
      return { text: block.source.text }

    case 'documentSourceContentBlock':
      // Convert content blocks to text
      return {
        text: block.source.content.map((b) => b.text).join('\n'),
      }

    case 'documentSourceS3Location':
      logger.warn('s3 document sources are not supported by gemini, skipping')
      return undefined

    default:
      return undefined
  }
}

// =============================================================================
// Gemini → Strands
// =============================================================================

/**
 * Maps a Gemini response chunk to SDK streaming events.
 *
 * @param chunk - Gemini response chunk
 * @param streamState - Mutable state object tracking message and content block state
 * @returns Array of SDK streaming events
 *
 * @internal
 */
export function mapChunkToEvents(chunk: GenerateContentResponse, streamState: GeminiStreamState): ModelStreamEvent[] {
  const events: ModelStreamEvent[] = []

  // Extract usage metadata if available
  if (chunk.usageMetadata) {
    const promptTokens = chunk.usageMetadata.promptTokenCount || 0
    const totalTokens = chunk.usageMetadata.totalTokenCount || 0
    streamState.inputTokens = promptTokens
    streamState.outputTokens = totalTokens - promptTokens
  }

  const candidates = chunk.candidates
  if (!candidates || candidates.length === 0) {
    return events
  }

  const candidate = candidates[0]
  if (!candidate) {
    return events
  }

  // Handle message start
  if (!streamState.messageStarted) {
    streamState.messageStarted = true
    events.push({
      type: 'modelMessageStartEvent',
      role: 'assistant',
    })
  }

  // Process content parts
  const content = candidate.content
  if (content && content.parts) {
    for (const part of content.parts) {
      if (!('text' in part) || !part.text) {
        continue
      }

      const isThought = 'thought' in part && part.thought === true

      if (isThought) {
        // Handle reasoning content
        // Close text block if transitioning from text to reasoning
        if (streamState.textContentBlockStarted) {
          events.push({ type: 'modelContentBlockStopEvent' })
          streamState.textContentBlockStarted = false
        }

        if (!streamState.reasoningContentBlockStarted) {
          streamState.reasoningContentBlockStarted = true
          events.push({ type: 'modelContentBlockStartEvent' })
        }

        // Extract signature if present
        let signature: string | undefined
        if ('thoughtSignature' in part && part.thoughtSignature) {
          signature = new TextDecoder().decode(part.thoughtSignature as Uint8Array)
        }

        events.push({
          type: 'modelContentBlockDeltaEvent',
          delta: {
            type: 'reasoningContentDelta',
            text: part.text,
            ...(signature !== undefined && { signature }),
          },
        })
      } else {
        // Handle regular text content
        // Close reasoning block if transitioning from reasoning to text
        if (streamState.reasoningContentBlockStarted) {
          events.push({ type: 'modelContentBlockStopEvent' })
          streamState.reasoningContentBlockStarted = false
        }

        if (!streamState.textContentBlockStarted) {
          streamState.textContentBlockStarted = true
          events.push({ type: 'modelContentBlockStartEvent' })
        }

        events.push({
          type: 'modelContentBlockDeltaEvent',
          delta: {
            type: 'textDelta',
            text: part.text,
          },
        })
      }
    }
  }

  // Handle finish reason
  const finishReason = candidate.finishReason
  if (finishReason && finishReason !== GeminiFinishReason.FINISH_REASON_UNSPECIFIED) {
    // Close any open content blocks
    if (streamState.textContentBlockStarted) {
      events.push({ type: 'modelContentBlockStopEvent' })
      streamState.textContentBlockStarted = false
    }
    if (streamState.reasoningContentBlockStarted) {
      events.push({ type: 'modelContentBlockStopEvent' })
      streamState.reasoningContentBlockStarted = false
    }

    const stopReason = FINISH_REASON_MAP[finishReason] || 'endTurn'

    events.push({
      type: 'modelMessageStopEvent',
      stopReason,
    })
  }

  return events
}
