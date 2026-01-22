/**
 * Constants for the Gemini model provider.
 */

import { FinishReason as GeminiFinishReason } from '@google/genai'
import type { StopReason } from '../../types/messages.js'

/**
 * Default Gemini model ID.
 */
export const DEFAULT_GEMINI_MODEL_ID = 'gemini-2.5-flash'

/**
 * Error types that can be detected from Gemini API errors.
 */
export type GeminiErrorType = 'contextOverflow'

/**
 * Configuration for handling a specific error status.
 * If messagePatterns is provided, the error message must match one of the patterns.
 * If messagePatterns is not provided, the status alone triggers the error type.
 */
export interface ErrorStatusConfig {
  type: GeminiErrorType
  messagePatterns?: Set<string>
}

/**
 * Mapping of Gemini API error statuses to error handling configuration.
 * Maps status codes to either direct error types or message-pattern-based detection.
 */
export const ERROR_STATUS_MAP: Record<string, ErrorStatusConfig> = {
  INVALID_ARGUMENT: {
    type: 'contextOverflow',
    messagePatterns: new Set(['exceeds the maximum number of tokens']),
  },
}

/**
 * Mapping of Gemini finish reasons to SDK stop reasons.
 * Only MAX_TOKENS needs explicit mapping; everything else defaults to endTurn.
 * TOOL_USE is handled separately via hasToolCalls flag.
 */
export const FINISH_REASON_MAP: Partial<Record<GeminiFinishReason, StopReason>> = {
  [GeminiFinishReason.MAX_TOKENS]: 'maxTokens',
}
