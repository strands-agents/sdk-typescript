/**
 * Adapters for converting between Strands SDK types and Gemini API format.
 */

import {
  type Content,
  type GenerateContentResponse,
  type Part,
  FinishReason as GeminiFinishReason,
} from '@google/genai'
import type { Message, StopReason } from '../../types/messages.js'
import type { ModelStreamEvent } from '../streaming.js'
import type { GeminiStreamState } from './types.js'

/**
 * Mapping of Gemini finish reasons to SDK stop reasons.
 * Only MAX_TOKENS needs explicit mapping; everything else defaults to endTurn.
 * TOOL_USE is handled separately via hasToolCalls flag.
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
 */
export function formatMessages(messages: Message[]): Content[] {
  const contents: Content[] = []

  for (const message of messages) {
    const parts: Part[] = []

    for (const block of message.content) {
      if (block.type === 'textBlock') {
        parts.push({ text: block.text })
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

// =============================================================================
// Gemini → Strands
// =============================================================================

/**
 * Maps a Gemini response chunk to SDK streaming events.
 *
 * @param chunk - Gemini response chunk
 * @param streamState - Mutable state object tracking message and content block state
 * @returns Array of SDK streaming events
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
      // Handle text content
      if ('text' in part && part.text) {
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
    // Close text content block if still open
    if (streamState.textContentBlockStarted) {
      events.push({ type: 'modelContentBlockStopEvent' })
      streamState.textContentBlockStarted = false
    }

    const stopReason = FINISH_REASON_MAP[finishReason] || 'endTurn'

    events.push({
      type: 'modelMessageStopEvent',
      stopReason,
    })
  }

  return events
}
