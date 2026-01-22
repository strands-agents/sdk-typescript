/**
 * Gemini → Strands: Converts Gemini API responses to Strands SDK streaming events.
 */

import { type GenerateContentResponse, FinishReason as GeminiFinishReason } from '@google/genai'
import type { ModelStreamEvent } from '../streaming.js'
import type { GeminiStreamState } from './types.js'
import { FINISH_REASON_MAP } from './constants.js'

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
    streamState.inputTokens = chunk.usageMetadata.promptTokenCount || 0
    streamState.outputTokens = chunk.usageMetadata.candidatesTokenCount || 0
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
