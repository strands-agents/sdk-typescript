import type { JSONValue } from './json'
import type { ToolResultContent } from '../tools/types'

/**
 * A message in a conversation between user and assistant.
 * Each message has a role (user or assistant) and an array of content blocks.
 */
export interface Message {
  /**
   * Discriminator for message type.
   */
  type: 'message'

  /**
   * The role of the message sender.
   */
  role: Role

  /**
   * Array of content blocks that make up this message.
   */
  content: ContentBlock[]
}

/**
 * Role of a message in a conversation.
 * Can be either 'user' (human input) or 'assistant' (model response).
 */
export type Role = 'user' | 'assistant'

/**
 * A block of content within a message.
 * Content blocks can contain text, tool usage requests, tool results, reasoning content, cache points,
 * images, videos, or documents.
 *
 * This is a discriminated union where the `type` field determines the content format.
 */
export type ContentBlock =
  | TextBlock
  | ToolUseBlock
  | ToolResultBlock
  | ReasoningBlock
  | CachePointBlock
  | ImageBlock
  | VideoBlock
  | DocumentBlock

/**
 * Text content block within a message.
 */
export interface TextBlock {
  /**
   * Discriminator for text content.
   */
  type: 'textBlock'

  /**
   * Plain text content.
   */
  text: string
}

/**
 * Tool use content block within a message.
 */
export interface ToolUseBlock {
  /**
   * Discriminator for tool use content.
   */
  type: 'toolUseBlock'

  /**
   * The name of the tool to execute.
   */
  name: string

  /**
   * Unique identifier for this tool use instance.
   */
  toolUseId: string

  /**
   * The input parameters for the tool.
   * This can be any JSON-serializable value.
   */
  input: JSONValue
}

/**
 * Tool result content block within a message.
 */
export interface ToolResultBlock {
  /**
   * Discriminator for tool result content.
   */
  type: 'toolResultBlock'

  /**
   * The ID of the tool use that this result corresponds to.
   */
  toolUseId: string

  /**
   * Status of the tool execution.
   */
  status: 'success' | 'error'

  /**
   * The content returned by the tool.
   */
  content: ToolResultContent[]
}

/**
 * Reasoning content block within a message.
 */
export interface ReasoningBlock {
  /**
   * Discriminator for reasoning content.
   */
  type: 'reasoningBlock'

  /**
   * The text content of the reasoning process.
   */
  text?: string

  /**
   * A cryptographic signature for verification purposes.
   */
  signature?: string

  /**
   * The redacted content of the reasoning process.
   */
  redactedContent?: Uint8Array
}

/**
 * Cache point block for prompt caching.
 * Marks a position in a message or system prompt where caching should occur.
 */
export interface CachePointBlock {
  /**
   * Discriminator for cache point.
   */
  type: 'cachePointBlock'

  /**
   * The cache type. Currently only 'default' is supported.
   */
  cacheType: 'default'
}

/**
 * Image content block within a message.
 * Supports images in PNG, JPEG, GIF, or WEBP formats.
 *
 * @see https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ImageBlock.html
 */
export interface ImageBlock {
  /**
   * Discriminator for image content.
   */
  type: 'imageBlock'

  /**
   * The format of the image.
   */
  format: 'png' | 'jpeg' | 'gif' | 'webp'

  /**
   * The source of the image data.
   */
  source: ImageSource
}

/**
 * Source of image data.
 * Can be either inline bytes or a URL (S3, HTTP, or file path).
 */
export type ImageSource = ImageSourceBytes | ImageSourceUrl

/**
 * Image data provided as inline bytes.
 */
export interface ImageSourceBytes {
  /**
   * Discriminator for bytes source.
   */
  type: 'imageSourceBytes'

  /**
   * Binary image data.
   */
  bytes: Uint8Array
}

/**
 * Image data referenced by URL.
 * Supports S3 URIs (s3://), HTTP URLs (http://, https://), and file paths (file://).
 * Currently only S3 URIs are supported; other URL types will throw an error.
 *
 * @see https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_S3Location.html
 */
export interface ImageSourceUrl {
  /**
   * Discriminator for URL source.
   */
  type: 'imageSourceUrl'

  /**
   * URL to the image file. Supported formats:
   * - S3: s3://bucket-name/key
   * - HTTP: http://example.com/image.png (not yet supported)
   * - File: file:///path/to/image.png (not yet supported)
   */
  url: string

  /**
   * AWS account ID of the S3 bucket owner (S3 URLs only).
   */
  bucketOwner?: string
}

/**
 * Video content block within a message.
 * Supports various video formats including MP4, MKV, MOV, WEBM, FLV, MPEG, MPG, WMV, and 3GP.
 *
 * @see https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_VideoBlock.html
 */
export interface VideoBlock {
  /**
   * Discriminator for video content.
   */
  type: 'videoBlock'

  /**
   * The format of the video.
   */
  format: 'mkv' | 'mov' | 'mp4' | 'webm' | 'flv' | 'mpeg' | 'mpg' | 'wmv' | 'three_gp'

  /**
   * The source of the video data.
   */
  source: VideoSource
}

/**
 * Source of video data.
 * Can be either inline bytes or a URL (S3, HTTP, or file path).
 */
export type VideoSource = VideoSourceBytes | VideoSourceUrl

/**
 * Video data provided as inline bytes.
 */
export interface VideoSourceBytes {
  /**
   * Discriminator for bytes source.
   */
  type: 'videoSourceBytes'

  /**
   * Binary video data.
   */
  bytes: Uint8Array
}

/**
 * Video data referenced by URL.
 * Supports S3 URIs (s3://), HTTP URLs (http://, https://), and file paths (file://).
 * Currently only S3 URIs are supported; other URL types will throw an error.
 *
 * @see https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_S3Location.html
 */
export interface VideoSourceUrl {
  /**
   * Discriminator for URL source.
   */
  type: 'videoSourceUrl'

  /**
   * URL to the video file. Supported formats:
   * - S3: s3://bucket-name/key
   * - HTTP: http://example.com/video.mp4 (not yet supported)
   * - File: file:///path/to/video.mp4 (not yet supported)
   */
  url: string

  /**
   * AWS account ID of the S3 bucket owner (S3 URLs only).
   */
  bucketOwner?: string
}

/**
 * Document content block within a message.
 * Supports various document formats including PDF, Office documents, CSV, HTML, text, and markdown.
 *
 * @see https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_DocumentBlock.html
 */
export interface DocumentBlock {
  /**
   * Discriminator for document content.
   */
  type: 'documentBlock'

  /**
   * Name of the document. Must be between 1 and 200 characters.
   */
  name: string

  /**
   * The source of the document data.
   */
  source: DocumentSource

  /**
   * The format of the document.
   */
  format?: 'pdf' | 'csv' | 'doc' | 'docx' | 'xls' | 'xlsx' | 'html' | 'txt' | 'md'

  /**
   * Configuration for citations in the document.
   */
  citations?: CitationsConfig

  /**
   * Additional context about the document.
   */
  context?: string
}

/**
 * Source of document data.
 * Can be inline bytes, structured content, URL, or plain text.
 */
export type DocumentSource = DocumentSourceBytes | DocumentSourceContent | DocumentSourceUrl | DocumentSourceText

/**
 * Document data provided as inline bytes.
 */
export interface DocumentSourceBytes {
  /**
   * Discriminator for bytes source.
   */
  type: 'documentSourceBytes'

  /**
   * Binary document data.
   */
  bytes: Uint8Array
}

/**
 * Document data provided as structured content blocks.
 */
export interface DocumentSourceContent {
  /**
   * Discriminator for content source.
   */
  type: 'documentSourceContent'

  /**
   * Array of content blocks that make up the document.
   */
  content: DocumentContentBlock[]
}

/**
 * A content block within a document.
 */
export interface DocumentContentBlock {
  /**
   * Text content of the block.
   */
  text: string
}

/**
 * Document data referenced by URL.
 * Supports S3 URIs (s3://), HTTP URLs (http://, https://), and file paths (file://).
 * Currently only S3 URIs are supported; other URL types will throw an error.
 *
 * @see https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_S3Location.html
 */
export interface DocumentSourceUrl {
  /**
   * Discriminator for URL source.
   */
  type: 'documentSourceUrl'

  /**
   * URL to the document file. Supported formats:
   * - S3: s3://bucket-name/key
   * - HTTP: http://example.com/document.pdf (not yet supported)
   * - File: file:///path/to/document.pdf (not yet supported)
   */
  url: string

  /**
   * AWS account ID of the S3 bucket owner (S3 URLs only).
   */
  bucketOwner?: string
}

/**
 * Document data provided as plain text.
 */
export interface DocumentSourceText {
  /**
   * Discriminator for text source.
   */
  type: 'documentSourceText'

  /**
   * Plain text content of the document.
   */
  text: string
}

/**
 * Configuration for citations in a document.
 */
export interface CitationsConfig {
  /**
   * Whether citations are enabled for this document.
   */
  enabled: boolean
}

/**
 * Reason why the model stopped generating content.
 *
 * - `contentFiltered` - Content was filtered by safety mechanisms
 * - `endTurn` - Natural end of the model's turn
 * - `guardrailIntervened` - A guardrail policy stopped generation
 * - `maxTokens` - Maximum token limit was reached
 * - `stopSequence` - A stop sequence was encountered
 * - `toolUse` - Model wants to use a tool
 */
export type StopReason =
  | 'contentFiltered'
  | 'endTurn'
  | 'guardrailIntervened'
  | 'maxTokens'
  | 'stopSequence'
  | 'toolUse'
  | 'modelContextWindowExceeded'
  | string

/**
 * System prompt for guiding model behavior.
 * Can be a simple string or an array of content blocks for advanced caching.
 *
 * @example
 * ```typescript
 * // Simple string
 * const prompt: SystemPrompt = 'You are a helpful assistant'
 *
 * // Array with cache points for advanced caching
 * const prompt: SystemPrompt = [
 *   { type: 'textBlock', text: 'You are a helpful assistant' },
 *   { type: 'textBlock', text: largeContextDocument },
 *   { type: 'cachePointBlock', cacheType: 'default' }
 * ]
 * ```
 */
export type SystemPrompt = string | SystemContentBlock[]

/**
 * A block of content within a system prompt.
 * Supports text content and cache points for prompt caching.
 *
 * This is a discriminated union where the `type` field determines the block format.
 */
export type SystemContentBlock = TextBlock | CachePointBlock
