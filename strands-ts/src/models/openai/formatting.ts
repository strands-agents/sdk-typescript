/**
 * Shared media formatting helpers for OpenAI adapters.
 *
 * @internal
 */

import type { ImageBlock, DocumentBlock } from '../../types/media.js'
import { encodeBase64 } from '../../types/media.js'
import { toMimeType } from '../../mime.js'

/**
 * Builds a `data:<mime>;base64,<payload>` URL for an image block.
 * Returns `undefined` for unsupported source types.
 */
export function formatImageDataUrl(imageBlock: ImageBlock): string | undefined {
  if (imageBlock.source.type === 'imageSourceBytes') {
    const base64 = encodeBase64(imageBlock.source.bytes)
    const mimeType = toMimeType(imageBlock.format) || `image/${imageBlock.format}`
    return `data:${mimeType};base64,${base64}`
  }
  if (imageBlock.source.type === 'imageSourceUrl') {
    return imageBlock.source.url
  }
  return undefined
}

/**
 * Builds a `data:<mime>;base64,<payload>` URL for a byte-sourced document block.
 * Returns `undefined` for non-bytes source types; callers are expected to handle
 * those cases themselves (they require API-specific fallback behavior).
 */
export function formatDocumentDataUrl(docBlock: DocumentBlock): string | undefined {
  if (docBlock.source.type === 'documentSourceBytes') {
    const base64 = encodeBase64(docBlock.source.bytes)
    const mimeType = toMimeType(docBlock.format) || `application/${docBlock.format}`
    return `data:${mimeType};base64,${base64}`
  }
  return undefined
}
