import { describe, it, expect } from 'vitest'
import {
  S3Location,
  ImageBlock,
  VideoBlock,
  DocumentBlock,
  type S3LocationData,
  type ImageBlockData,
  type VideoBlockData,
  type DocumentBlockData,
} from '../media.js'
import { TextBlock } from '../messages.js'

describe('S3Location', () => {
  it('creates instance with uri only', () => {
    const data: S3LocationData = {
      uri: 's3://my-bucket/image.jpg',
    }
    const location = new S3Location(data)
    expect(location).toEqual({
      uri: 's3://my-bucket/image.jpg',
    })
  })

  it('creates instance with uri and bucketOwner', () => {
    const data: S3LocationData = {
      uri: 's3://my-bucket/image.jpg',
      bucketOwner: '123456789012',
    }
    const location = new S3Location(data)
    expect(location).toEqual({
      uri: 's3://my-bucket/image.jpg',
      bucketOwner: '123456789012',
    })
  })
})

describe('ImageBlock', () => {
  it('creates instance with bytes source', () => {
    const bytes = new Uint8Array([1, 2, 3])
    const data: ImageBlockData = {
      format: 'jpeg',
      source: { bytes },
    }
    const block = new ImageBlock(data)
    expect(block).toMatchObject({
      type: 'imageBlock',
      format: 'jpeg',
      source: { type: 'imageSourceBytes', bytes },
    })
  })

  it('creates instance with S3 location source', () => {
    const data: ImageBlockData = {
      format: 'png',
      source: {
        s3Location: {
          uri: 's3://my-bucket/image.png',
          bucketOwner: '123456789012',
        },
      },
    }
    const block = new ImageBlock(data)
    expect(block).toMatchObject({
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
    const data: ImageBlockData = {
      format: 'webp',
      source: { url: 'https://example.com/image.webp' },
    }
    const block = new ImageBlock(data)
    expect(block).toMatchObject({
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
    const data: VideoBlockData = {
      format: 'mp4',
      source: { bytes },
    }
    const block = new VideoBlock(data)
    expect(block).toMatchObject({
      type: 'videoBlock',
      format: 'mp4',
      source: { type: 'videoSourceBytes', bytes },
    })
  })

  it('creates instance with S3 location source', () => {
    const data: VideoBlockData = {
      format: 'webm',
      source: {
        s3Location: {
          uri: 's3://my-bucket/video.webm',
        },
      },
    }
    const block = new VideoBlock(data)
    expect(block).toMatchObject({
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
    const data: DocumentBlockData = {
      name: 'document.pdf',
      format: 'pdf',
      source: { bytes },
    }
    const block = new DocumentBlock(data)
    expect(block).toMatchObject({
      type: 'documentBlock',
      name: 'document.pdf',
      format: 'pdf',
      source: { type: 'documentSourceBytes', bytes },
    })
  })

  it('creates instance with text source', () => {
    const data: DocumentBlockData = {
      name: 'note.txt',
      format: 'txt',
      source: { text: 'Hello world' },
    }
    const block = new DocumentBlock(data)
    expect(block).toMatchObject({
      type: 'documentBlock',
      format: 'txt',
      name: 'note.txt',
      source: { type: 'documentSourceText', text: 'Hello world' },
    })
  })

  it('creates instance with content source', () => {
    const data: DocumentBlockData = {
      name: 'report.html',
      format: 'html',
      source: {
        content: [{ text: 'Introduction' }, { text: 'Conclusion' }],
      },
    }
    const block = new DocumentBlock(data)
    expect(block).toMatchObject({
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
    const data: DocumentBlockData = {
      name: 'report.pdf',
      format: 'pdf',
      source: {
        s3Location: {
          uri: 's3://my-bucket/report.pdf',
          bucketOwner: '123456789012',
        },
      },
    }
    const block = new DocumentBlock(data)
    expect(block).toMatchObject({
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
    const data: DocumentBlockData = {
      name: 'upload.pdf',
      format: 'pdf',
      source: { bytes, filename: 'original-name.pdf' },
    }
    const block = new DocumentBlock(data)
    expect(block).toMatchObject({
      type: 'documentBlock',
      name: 'upload.pdf',
      format: 'pdf',
      source: { type: 'documentSourceBytes', bytes, filename: 'original-name.pdf' },
    })
  })

  it('creates instance with text and filename', () => {
    const data: DocumentBlockData = {
      name: 'note.txt',
      format: 'txt',
      source: { text: 'Hello world' },
    }
    const block = new DocumentBlock(data)
    expect(block).toMatchObject({
      type: 'documentBlock',
      format: 'txt',
      name: 'note.txt',
      source: { type: 'documentSourceText', text: 'Hello world' },
    })
  })

  it('creates instance with citations and context', () => {
    const bytes = new Uint8Array([1, 2, 3])
    const data: DocumentBlockData = {
      name: 'research.pdf',
      format: 'pdf',
      source: { bytes },
      citations: { enabled: true },
      context: 'Research paper about AI',
    }
    const block = new DocumentBlock(data)
    expect(block).toMatchObject({
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
