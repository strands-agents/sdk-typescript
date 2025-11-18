/**
 * Media and document content types for multimodal AI interactions.
 *
 * This module provides types for handling images, videos, and documents
 * with support for multiple sources (bytes, S3, URLs, files).
 */

import { TextBlock, type TextBlockData } from './messages.js'

/**
 * Data for an S3 location.
 * Used by Bedrock for referencing media and documents stored in S3.
 */
export interface S3LocationData {
  /**
   * S3 URI in format: s3://bucket-name/key-name
   */
  uri: string

  /**
   * AWS account ID of the S3 bucket owner (12-digit).
   * Required if the bucket belongs to another AWS account.
   */
  bucketOwner?: string
}

/**
 * S3 location for Bedrock media and document sources.
 */
export class S3Location implements S3LocationData {
  readonly uri: string
  readonly bucketOwner?: string

  constructor(data: S3LocationData) {
    this.uri = data.uri
    if (data.bucketOwner !== undefined) {
      this.bucketOwner = data.bucketOwner
    }
  }
}

/**
 * Image format type.
 */
export type ImageFormat = 'png' | 'jpeg' | 'gif' | 'webp'

/**
 * Source for an image (Data version).
 * Supports multiple formats for different providers.
 */
export type ImageSourceData =
  | { bytes: Uint8Array } // raw binary data
  | { s3Location: S3LocationData } // Bedrock: S3 reference
  | { url: string } // https://

/**
 * Source for an image (Class version).
 */
export type ImageSource =
  | { type: 'imageSourceBytes'; bytes: Uint8Array }
  | { type: 'imageSourceS3Location'; s3Location: S3Location }
  | { type: 'imageSourceUrl'; url: string }

/**
 * Data for an image block.
 */
export interface ImageBlockData {
  /**
   * Image format.
   */
  format: ImageFormat

  /**
   * Image source.
   */
  source: ImageSourceData
}

/**
 * Image content block.
 */
export class ImageBlock implements ImageBlockData {
  /**
   * Discriminator for image content.
   */
  readonly type = 'imageBlock' as const

  /**
   * Image format.
   */
  readonly format: ImageFormat

  /**
   * Image source.
   */
  readonly source: ImageSource

  constructor(data: ImageBlockData) {
    this.format = data.format
    this.source = this._convertSource(data.source)
  }

  private _convertSource(source: ImageSourceData): ImageSource {
    if ('bytes' in source) {
      return {
        type: 'imageSourceBytes',
        bytes: source.bytes,
      }
    }
    if ('url' in source) {
      return {
        type: 'imageSourceUrl',
        url: source.url,
      }
    }
    if ('s3Location' in source) {
      return {
        type: 'imageSourceS3Location',
        s3Location: new S3Location(source.s3Location),
      }
    }
    throw new Error('Invalid image source')
  }
}

/**
 * Video format type.
 */
export type VideoFormat = 'mkv' | 'mov' | 'mp4' | 'webm' | 'flv' | 'mpeg' | 'mpg' | 'wmv' | '3gp'

/**
 * Source for a video (Data version).
 */
export type VideoSourceData = { bytes: Uint8Array } | { s3Location: S3LocationData } // Bedrock: up to 1GB

/**
 * Source for a video (Class version).
 */
export type VideoSource =
  | { type: 'videoSourceBytes'; bytes: Uint8Array }
  | { type: 'videoSourceS3Location'; s3Location: S3Location }

/**
 * Data for a video block.
 */
export interface VideoBlockData {
  /**
   * Video format.
   */
  format: VideoFormat

  /**
   * Video source.
   */
  source: VideoSourceData
}

/**
 * Video content block.
 */
export class VideoBlock implements VideoBlockData {
  /**
   * Discriminator for video content.
   */
  readonly type = 'videoBlock' as const

  /**
   * Video format.
   */
  readonly format: VideoFormat

  /**
   * Video source.
   */
  readonly source: VideoSource

  constructor(data: VideoBlockData) {
    this.format = data.format
    this.source = this._convertSource(data.source)
  }

  private _convertSource(source: VideoSourceData): VideoSource {
    if ('bytes' in source) {
      return {
        type: 'videoSourceBytes',
        bytes: source.bytes,
      }
    }
    if ('s3Location' in source) {
      return { type: 'videoSourceS3Location', s3Location: new S3Location(source.s3Location) }
    }
    throw new Error('Invalid video source')
  }
}

/**
 * Document format type.
 */
export type DocumentFormat = 'pdf' | 'csv' | 'doc' | 'docx' | 'xls' | 'xlsx' | 'html' | 'txt' | 'md'

/**
 * Content blocks that can be nested inside a document.
 * Documents can contain text blocks for structured content.
 */
export type DocumentContentBlockData = TextBlockData
export type DocumentContentBlock = TextBlock

/**
 * Source for a document (Data version).
 * Supports multiple formats including structured content.
 */
export type DocumentSourceData =
  | { bytes: Uint8Array; filename?: string } // raw binary data
  | { text: string } // plain text
  | { content: DocumentContentBlockData[] } // structured content
  | { s3Location: S3LocationData } // S3 reference

/**
 * Source for a document (Class version).
 */
export type DocumentSource =
  | { type: 'documentSourceBytes'; bytes: Uint8Array; filename?: string }
  | { type: 'documentSourceText'; text: string }
  | { type: 'documentSourceContentBlock'; content: DocumentContentBlock[] }
  | { type: 'documentSourceS3Location'; s3Location: S3Location }

/**
 * Data for a document block.
 */
export interface DocumentBlockData {
  /**
   * Document name.
   */
  name: string

  /**
   * Document format.
   */
  format: DocumentFormat

  /**
   * Document source.
   */
  source: DocumentSourceData

  /**
   * Citation configuration.
   */
  citations?: { enabled: boolean }

  /**
   * Context information for the document.
   */
  context?: string
}

/**
 * Document content block.
 */
export class DocumentBlock implements DocumentBlockData {
  /**
   * Discriminator for document content.
   */
  readonly type = 'documentBlock' as const

  /**
   * Document name.
   */
  readonly name: string

  /**
   * Document format.
   */
  readonly format: DocumentFormat

  /**
   * Document source.
   */
  readonly source: DocumentSource

  /**
   * Citation configuration.
   */
  readonly citations?: { enabled: boolean }

  /**
   * Context information for the document.
   */
  readonly context?: string

  constructor(data: DocumentBlockData) {
    this.name = data.name
    this.format = data.format
    this.source = this._convertSource(data.source)
    if (data.citations !== undefined) {
      this.citations = data.citations
    }
    if (data.context !== undefined) {
      this.context = data.context
    }
  }

  private _convertSource(source: DocumentSourceData): DocumentSource {
    if ('bytes' in source) {
      return {
        type: 'documentSourceBytes',
        bytes: source.bytes,
        ...(source.filename === undefined ? {} : { filename: source.filename }),
      }
    }
    if ('text' in source) {
      return {
        type: 'documentSourceText',
        text: source.text,
      }
    }
    if ('content' in source) {
      return {
        type: 'documentSourceContentBlock',
        content: source.content.map((block) => new TextBlock(block.text)),
      }
    }
    if ('s3Location' in source) {
      return {
        type: 'documentSourceS3Location',
        s3Location: new S3Location(source.s3Location),
      }
    }
    throw new Error('Invalid document source')
  }
}
