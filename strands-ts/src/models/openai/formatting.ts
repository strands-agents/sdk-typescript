/**
 * Shared media formatting helpers for OpenAI adapters.
 *
 * @internal
 */

import type { ImageBlock } from '../../types/media.js'
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
