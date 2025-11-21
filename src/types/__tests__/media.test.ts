import { describe, it, expect } from 'vitest'
import {
  S3Location,
  ImageBlock,
  VideoBlock,
  DocumentBlock,
  type ImageBlockData,
  type VideoBlockData,
  type DocumentBlockData,
} from '../media.js'
import { TextBlock } from '../messages.js'

describe('S3Location', () => {
  it('creates instance with uri only', () => {
    const location = new S3Location({
      uri: 's3://my-bucket/image.jpg',
    })
    expect(location).toEqual({
      uri: 's3://my-bucket/image.jpg',
    })
  })

  it('creates instance with uri and bucketOwner', () => {
    const location = new S3Location({
      uri: 's3://my-bucket/image.jpg',
      bucketOwner: '123456789012',
    })
    expect(location).toEqual({
      uri: 's3://my-bucket/image.jpg',
      bucketOwner: '123456789012',
    })
  })
})

describe('ImageBlock', () => {
  it('creates instance with bytes source', () => {
    const bytes = new Uint8Array([1, 2, 3])
    const block = new ImageBlock({
      format: 'jpeg',
      source: { bytes },
    })
    expect(block).toEqual({
      type: 'imageBlock',
      format: 'jpeg',
      source: { type: 'imageSourceBytes', bytes },
    })
  })

  it('creates instance with S3 location source', () => {
    const block = new ImageBlock({
      format: 'png',
      source: {
        s3Location: {
          uri: 's3://my-bucket/image.png',
          bucketOwner: '123456789012',
        },
      },
    })
    expect(block).toEqual({
      type: 'imageBlock',
      format: 'png',
      source: {
        type: 'imageSourceS3Location',
        s3Location: expect.any(S3Location),
      },
    })
    // Assert S3Location was converted to class
    const s3Source = block.source as { type: 'imageSourceS3Location'; s3Location: S3Location }
    expect(s3Source.s3Location).toBeInstanceOf(S3Location)
    expect(s3Source.s3Location.uri).toBe('s3://my-bucket/image.png')
    expect(s3Source.s3Location.bucketOwner).toBe('123456789012')
  })

  it('creates instance with URL source', () => {
    const block = new ImageBlock({
      format: 'webp',
      source: { url: 'https://example.com/image.webp' },
    })
    expect(block).toEqual({
      type: 'imageBlock',
      format: 'webp',
      source: { type: 'imageSourceUrl', url: 'https://example.com/image.webp' },
    })
  })

  it('throws error for invalid source', () => {
    const data = {
      format: 'jpeg',
      source: {},
    } as ImageBlockData
    expect(() => new ImageBlock(data)).toThrow('Invalid image source')
  })
})

describe('VideoBlock', () => {
  it('creates instance with bytes source', () => {
    const bytes = new Uint8Array([1, 2, 3])
    const block = new VideoBlock({
      format: 'mp4',
      source: { bytes },
    })
    expect(block).toEqual({
      type: 'videoBlock',
      format: 'mp4',
      source: { type: 'videoSourceBytes', bytes },
    })
  })

  it('creates instance with S3 location source', () => {
    const block = new VideoBlock({
      format: 'webm',
      source: {
        s3Location: {
          uri: 's3://my-bucket/video.webm',
        },
      },
    })
    expect(block).toEqual({
      type: 'videoBlock',
      format: 'webm',
      source: {
        type: 'videoSourceS3Location',
        s3Location: expect.any(S3Location),
      },
    })
    // Assert S3Location was converted to class
    const s3Source = block.source as { type: 'videoSourceS3Location'; s3Location: S3Location }
    expect(s3Source.s3Location).toBeInstanceOf(S3Location)
    expect(s3Source.s3Location.uri).toBe('s3://my-bucket/video.webm')
  })

  it('throws error for invalid source', () => {
    const data = {
      format: 'mp4',
      source: {},
    } as VideoBlockData
    expect(() => new VideoBlock(data)).toThrow('Invalid video source')
  })
})

describe('DocumentBlock', () => {
  it('creates instance with bytes source', () => {
    const bytes = new Uint8Array([1, 2, 3])
    const block = new DocumentBlock({
      name: 'document.pdf',
      format: 'pdf',
      source: { bytes },
    })
    expect(block).toEqual({
      type: 'documentBlock',
      name: 'document.pdf',
      format: 'pdf',
      source: { type: 'documentSourceBytes', bytes },
    })
  })

  it('creates instance with text source', () => {
    const block = new DocumentBlock({
      name: 'note.txt',
      format: 'txt',
      source: { text: 'Hello world' },
    })
    expect(block).toEqual({
      type: 'documentBlock',
      format: 'txt',
      name: 'note.txt',
      source: { type: 'documentSourceText', text: 'Hello world' },
    })
  })

  it('creates instance with content source', () => {
    const block = new DocumentBlock({
      name: 'report.html',
      format: 'html',
      source: {
        content: [{ text: 'Introduction' }, { text: 'Conclusion' }],
      },
    })
    expect(block).toEqual({
      type: 'documentBlock',
      name: 'report.html',
      format: 'html',
      source: {
        type: 'documentSourceContentBlock',
        content: [expect.any(TextBlock), expect.any(TextBlock)],
      },
    })
    // Assert content blocks were converted to TextBlock instances
    const contentSource = block.source as { type: 'documentSourceContentBlock'; content: TextBlock[] }
    expect(contentSource.content).toHaveLength(2)
    expect(contentSource.content[0]).toBeInstanceOf(TextBlock)
    expect(contentSource.content[0]!.text).toBe('Introduction')
    expect(contentSource.content[1]).toBeInstanceOf(TextBlock)
    expect(contentSource.content[1]!.text).toBe('Conclusion')
  })

  it('creates instance with S3 location source', () => {
    const block = new DocumentBlock({
      name: 'report.pdf',
      format: 'pdf',
      source: {
        s3Location: {
          uri: 's3://my-bucket/report.pdf',
          bucketOwner: '123456789012',
        },
      },
    })
    expect(block).toEqual({
      type: 'documentBlock',
      name: 'report.pdf',
      format: 'pdf',
      source: {
        type: 'documentSourceS3Location',
        s3Location: {
          uri: 's3://my-bucket/report.pdf',
          bucketOwner: '123456789012',
        },
      },
    })
  })

  it('creates instance with bytes and filename', () => {
    const bytes = new Uint8Array([1, 2, 3])
    const block = new DocumentBlock({
      name: 'upload.pdf',
      format: 'pdf',
      source: { bytes },
    })
    expect(block).toEqual({
      type: 'documentBlock',
      name: 'upload.pdf',
      format: 'pdf',
      source: { type: 'documentSourceBytes', bytes },
    })
  })

  it('creates instance with text and filename', () => {
    const block = new DocumentBlock({
      name: 'note.txt',
      format: 'txt',
      source: { text: 'Hello world' },
    })
    expect(block).toEqual({
      type: 'documentBlock',
      format: 'txt',
      name: 'note.txt',
      source: { type: 'documentSourceText', text: 'Hello world' },
    })
  })

  it('creates instance with citations and context', () => {
    const bytes = new Uint8Array([1, 2, 3])
    const block = new DocumentBlock({
      name: 'research.pdf',
      format: 'pdf',
      source: { bytes },
      citations: { enabled: true },
      context: 'Research paper about AI',
    })
    expect(block).toEqual({
      type: 'documentBlock',
      name: 'research.pdf',
      format: 'pdf',
      source: {
        type: 'documentSourceBytes',
        bytes,
      },
      citations: { enabled: true },
      context: 'Research paper about AI',
    })
  })

  it('throws error for invalid source', () => {
    const data = {
      name: 'doc.pdf',
      format: 'pdf',
      source: {},
    } as DocumentBlockData
    expect(() => new DocumentBlock(data)).toThrow('Invalid document source')
  })
})
