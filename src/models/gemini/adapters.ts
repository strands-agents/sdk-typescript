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
import { encodeBase64, getMimeType, type ImageBlock, type DocumentBlock, type VideoBlock } from '../../types/media.js'
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
      formatContentBlock(block, parts)
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
 * Formats a content block to one or more Gemini Parts, pushing them into the provided array.
 *
 * @param block - SDK content block
 * @param parts - Array to push formatted parts into
 *
 * @internal
 */
function formatContentBlock(block: ContentBlock, parts: Part[]): void {
  switch (block.type) {
    case 'textBlock':
      parts.push({ text: block.text })
      return

    case 'imageBlock': {
      const part = formatImageBlock(block)
      if (part) parts.push(part)
      return
    }

    case 'reasoningBlock': {
      const part = formatReasoningBlock(block)
      if (part) parts.push(part)
      return
    }

    case 'documentBlock':
      formatDocumentBlock(block, parts)
      return

    case 'videoBlock': {
      const part = formatVideoBlock(block)
      if (part) parts.push(part)
      return
    }

    case 'cachePointBlock':
      logger.warn('block_type=<cachePointBlock> | cache points not supported by gemini, skipping')
      return

    case 'guardContentBlock':
      logger.warn('block_type=<guardContentBlock> | guard content not supported by gemini, skipping')
      return

    case 'toolUseBlock':
    case 'toolResultBlock':
      logger.warn(`block_type=<${block.type}> | tool blocks not yet supported by gemini, skipping`)
      return

    default:
      return
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
    case 'imageSourceBytes':
      return {
        inlineData: {
          data: encodeBase64(block.source.bytes),
          mimeType,
        },
      }

    case 'imageSourceUrl':
      return {
        fileData: {
          fileUri: block.source.url,
          mimeType,
        },
      }

    case 'imageSourceS3Location':
      logger.warn('source_type=<imageSourceS3Location> | s3 sources not supported by gemini, skipping')
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
    part.thoughtSignature = block.signature
  }

  return part
}

/**
 * Formats a document block to one or more Gemini Parts, pushing them into the provided array.
 *
 * @param block - Document block to format
 * @param parts - Array to push formatted parts into
 *
 * @internal
 */
function formatDocumentBlock(block: DocumentBlock, parts: Part[]): void {
  const mimeType = getMimeType(block.format) ?? `application/${block.format}`

  switch (block.source.type) {
    case 'documentSourceBytes':
      parts.push({
        inlineData: {
          data: encodeBase64(block.source.bytes),
          mimeType,
        },
      })
      return

    case 'documentSourceText':
      // Convert text to bytes - Gemini API doesn't accept text directly
      parts.push({
        inlineData: {
          data: encodeBase64(new TextEncoder().encode(block.source.text)),
          mimeType,
        },
      })
      return

    case 'documentSourceContentBlock':
      // Push each content block as a separate text part
      for (const contentBlock of block.source.content) {
        parts.push({ text: contentBlock.text })
      }
      return

    case 'documentSourceS3Location':
      logger.warn('source_type=<documentSourceS3Location> | s3 sources not supported by gemini, skipping')
      return

    default:
      return
  }
}

/**
 * Formats a video block to a Gemini Part.
 *
 * @param block - Video block to format
 * @returns Gemini Part with inline data
 *
 * @internal
 */
function formatVideoBlock(block: VideoBlock): Part | undefined {
  const mimeType = getMimeType(block.format) ?? `video/${block.format}`

  switch (block.source.type) {
    case 'videoSourceBytes':
      return {
        inlineData: {
          data: encodeBase64(block.source.bytes),
          mimeType,
        },
      }

    case 'videoSourceS3Location':
      logger.warn('source_type=<videoSourceS3Location> | s3 sources not supported by gemini, skipping')
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
      // Only process parts that have text content
      if ('text' in part && part.text) {
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
          const signature = part.thoughtSignature

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
