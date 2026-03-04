/**
 * Conversion utilities between Strands SDK content blocks and A2A protocol parts.
 *
 * Supports text, images, videos, documents, and structured data, matching
 * the Python SDK's content conversion behavior.
 */

import type { Part, FileWithBytes, FileWithUri } from '@a2a-js/sdk'
import type { ContentBlock } from '../types/messages.js'
import { TextBlock } from '../types/messages.js'
import type { ImageFormat, DocumentFormat, VideoFormat, MediaFormats } from '../types/media.js'
import { ImageBlock, VideoBlock, DocumentBlock, decodeBase64, encodeBase64, MIME_TYPES } from '../types/media.js'
import { logger } from '../logging/logger.js'

// Reverse lookup: MIME type → canonical format, built from the single source of truth in media.ts.
// Sorted by format name length so aliases (jpg, mpg) are inserted first and overwritten by
// canonical forms (jpeg, mpeg), matching the Python SDK's format normalization behavior.
const MIME_TO_FORMAT: ReadonlyMap<string, MediaFormats> = new Map(
  Object.entries(MIME_TYPES)
    .sort(([a], [b]) => a.length - b.length)
    .map(([format, mime]) => [mime, format as MediaFormats])
)

/**
 * Converts A2A protocol parts to Strands SDK content blocks.
 *
 * Handles text, file (image/video/document), and structured data parts,
 * matching the Python SDK's `_convert_a2a_parts_to_content_blocks` behavior.
 *
 * @param parts - Array of A2A protocol parts
 * @returns Array of Strands content blocks
 */
export function partsToContentBlocks(parts: Part[]): ContentBlock[] {
  const blocks: ContentBlock[] = []

  for (const part of parts) {
    try {
      if (part.kind === 'text') {
        blocks.push(new TextBlock(part.text))
      } else if (part.kind === 'file') {
        blocks.push(_convertFilePart(part.file))
      } else if (part.kind === 'data') {
        const dataText = JSON.stringify(part.data, null, 2)
        blocks.push(new TextBlock(`[Structured Data]\n${dataText}`))
      }
    } catch {
      logger.warn(`part_kind=<${part.kind}> | failed to convert A2A part to content block`)
    }
  }

  return blocks
}

/**
 * Converts Strands SDK content blocks to A2A protocol parts.
 *
 * Supports text, image, video, and document blocks. Image and video blocks
 * with byte sources are encoded as base64 file parts; URL-based sources
 * become URI file parts. Unsupported block types are silently skipped.
 *
 * @param blocks - Array of Strands content blocks
 * @returns Array of A2A parts
 */
export function contentBlocksToParts(blocks: ContentBlock[]): Part[] {
  const parts: Part[] = []

  for (const block of blocks) {
    if (block.type === 'textBlock') {
      parts.push({ kind: 'text', text: block.text })
    } else if (block.type === 'imageBlock' || block.type === 'videoBlock') {
      const filePart = _mediaBlockToFilePart(block)
      if (filePart) parts.push(filePart)
    } else if (block.type === 'documentBlock') {
      const filePart = _documentBlockToFilePart(block)
      if (filePart) parts.push(filePart)
    }
  }

  return parts
}

/**
 * Converts an A2A FilePart to the appropriate Strands content block.
 *
 * @param file - The file object from a FilePart (either bytes or URI based)
 * @returns ContentBlock for the file
 */
function _convertFilePart(file: FileWithBytes | FileWithUri): ContentBlock {
  if ('bytes' in file) {
    const decoded = decodeBase64(file.bytes)
    const fileType = _getFileType(file.mimeType)
    const format = _getFormat(file.mimeType, fileType)

    if (fileType === 'image') {
      return new ImageBlock({ format: format as ImageFormat, source: { bytes: decoded } })
    }

    if (fileType === 'video') {
      return new VideoBlock({ format: format as VideoFormat, source: { bytes: decoded } })
    }

    // Document or unknown — treat as document (matches Python behavior)
    return new DocumentBlock({
      name: file.name ?? 'document',
      format: format as DocumentFormat,
      source: { bytes: decoded },
    })
  }

  const name = file.name ?? 'file'
  return new TextBlock(`[File: ${name} (${file.uri})]`)
}

/**
 * Classifies a MIME type into a file category.
 *
 * @param mimeType - The MIME type string
 * @returns The file type category
 */
function _getFileType(mimeType: string | undefined): 'image' | 'video' | 'document' | 'unknown' {
  if (!mimeType) {
    return 'unknown'
  }

  const lower = mimeType.toLowerCase()
  if (lower.startsWith('image/')) return 'image'
  if (lower.startsWith('video/')) return 'video'
  if (lower.startsWith('text/') || lower.startsWith('application/')) return 'document'
  return 'unknown'
}

/**
 * Resolves a MIME type to a Strands media format using the reverse MIME_TYPES lookup.
 * Falls back to the MIME subtype for unrecognized types.
 *
 * @param mimeType - The MIME type string
 * @param fileType - The classified file type
 * @returns The format string
 */
function _getFormat(mimeType: string | undefined, fileType: string): string {
  if (!mimeType) {
    return fileType === 'image' ? 'png' : fileType === 'video' ? 'mp4' : 'txt'
  }

  const lower = mimeType.toLowerCase()

  // Use the reverse lookup from MIME_TYPES (handles complex types like application/vnd.ms-excel → xls)
  const known = MIME_TO_FORMAT.get(lower)
  if (known) {
    return known
  }

  // Fallback: extract subtype from MIME (e.g., image/tiff → tiff)
  if (lower.includes('/')) {
    return lower.split('/').pop()!
  }

  return 'txt'
}

/**
 * Converts an ImageBlock or VideoBlock to an A2A FilePart.
 *
 * @param block - The image or video block
 * @returns A2A FilePart, or undefined if the source type is unsupported
 */
function _mediaBlockToFilePart(block: ImageBlock | VideoBlock): Part | undefined {
  const mimeType = MIME_TYPES[block.format]

  if (block.source.type === 'imageSourceBytes' || block.source.type === 'videoSourceBytes') {
    return { kind: 'file', file: { bytes: encodeBase64(block.source.bytes), mimeType } }
  }

  if (block.source.type === 'imageSourceUrl') {
    return { kind: 'file', file: { uri: (block.source as { type: 'imageSourceUrl'; url: string }).url, mimeType } }
  }

  return undefined
}

/**
 * Converts a DocumentBlock to an A2A FilePart.
 *
 * @param block - The document block
 * @returns A2A FilePart, or undefined if the source type is unsupported
 */
function _documentBlockToFilePart(block: DocumentBlock): Part | undefined {
  const mimeType = MIME_TYPES[block.format]

  if (block.source.type === 'documentSourceBytes') {
    return { kind: 'file', file: { bytes: encodeBase64(block.source.bytes), mimeType, name: block.name } }
  }

  if (block.source.type === 'documentSourceText') {
    return { kind: 'text', text: block.source.text }
  }

  return undefined
}
