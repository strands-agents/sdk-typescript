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
    expect(location.uri).toBe('s3://my-bucket/image.jpg')
    expect(location.bucketOwner).toBeUndefined()
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
    expect(block.type).toBe('imageBlock')
    expect(block.format).toBe('jpeg')
    expect(block.source).toEqual({ bytes })
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
    expect(block.type).toBe('imageBlock')
    expect(block.format).toBe('png')
    expect(block.source).toEqual({
      s3Location: expect.any(S3Location),
    })
    // Verify S3Location was converted to class
    if ('s3Location' in block.source) {
      expect(block.source.s3Location).toBeInstanceOf(S3Location)
      expect(block.source.s3Location.uri).toBe('s3://my-bucket/image.png')
      expect(block.source.s3Location.bucketOwner).toBe('123456789012')
    }
  })

  it('creates instance with URL source', () => {
    const data: ImageBlockData = {
      format: 'webp',
      source: { url: 'https://example.com/image.webp' },
    }
    const block = new ImageBlock(data)
    expect(block.type).toBe('imageBlock')
    expect(block.format).toBe('webp')
    expect(block.source).toEqual({ url: 'https://example.com/image.webp' })
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
    expect(block.type).toBe('videoBlock')
    expect(block.format).toBe('mp4')
    expect(block.source).toEqual({ bytes })
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
    expect(block.type).toBe('videoBlock')
    expect(block.format).toBe('webm')
    expect(block.source).toEqual({
      s3Location: expect.any(S3Location),
    })
    // Verify S3Location was converted to class
    if ('s3Location' in block.source) {
      expect(block.source.s3Location).toBeInstanceOf(S3Location)
      expect(block.source.s3Location.uri).toBe('s3://my-bucket/video.webm')
    }
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
    expect(block.type).toBe('documentBlock')
    expect(block.name).toBe('document.pdf')
    expect(block.format).toBe('pdf')
    expect(block.source).toEqual({ bytes })
    expect(block.citations).toBeUndefined()
    expect(block.context).toBeUndefined()
  })

  it('creates instance with text source', () => {
    const data: DocumentBlockData = {
      name: 'note.txt',
      format: 'txt',
      source: { text: 'Hello world' },
    }
    const block = new DocumentBlock(data)
    expect(block.type).toBe('documentBlock')
    expect(block.name).toBe('note.txt')
    expect(block.format).toBe('txt')
    expect(block.source).toEqual({ text: 'Hello world' })
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
    expect(block.type).toBe('documentBlock')
    expect(block.name).toBe('report.html')
    expect(block.format).toBe('html')
    // Verify content blocks were converted to TextBlock instances
    if ('content' in block.source) {
      expect(block.source.content).toHaveLength(2)
      expect(block.source.content[0]).toBeInstanceOf(TextBlock)
      expect(block.source.content[0]!.text).toBe('Introduction')
      expect(block.source.content[1]).toBeInstanceOf(TextBlock)
      expect(block.source.content[1]!.text).toBe('Conclusion')
    }
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
    expect(block.type).toBe('documentBlock')
    expect(block.source).toEqual({
      s3Location: expect.any(S3Location),
    })
    // Verify S3Location was converted to class
    if ('s3Location' in block.source) {
      expect(block.source.s3Location).toBeInstanceOf(S3Location)
      expect(block.source.s3Location.uri).toBe('s3://my-bucket/report.pdf')
      expect(block.source.s3Location.bucketOwner).toBe('123456789012')
    }
  })

  it('creates instance with fileId source', () => {
    const data: DocumentBlockData = {
      name: 'file.pdf',
      format: 'pdf',
      source: { fileId: 'file-abc123', filename: 'original.pdf' },
    }
    const block = new DocumentBlock(data)
    expect(block.type).toBe('documentBlock')
    expect(block.source).toEqual({ fileId: 'file-abc123', filename: 'original.pdf' })
  })

  it('creates instance with bytes and filename', () => {
    const bytes = new Uint8Array([1, 2, 3])
    const data: DocumentBlockData = {
      name: 'upload.pdf',
      format: 'pdf',
      source: { bytes, filename: 'original-name.pdf' },
    }
    const block = new DocumentBlock(data)
    expect(block.type).toBe('documentBlock')
    expect(block.source).toEqual({ bytes, filename: 'original-name.pdf' })
  })

  it('creates instance with text and filename', () => {
    const data: DocumentBlockData = {
      name: 'note.txt',
      format: 'txt',
      source: { text: 'Hello world', filename: 'greeting.txt' },
    }
    const block = new DocumentBlock(data)
    expect(block.type).toBe('documentBlock')
    expect(block.source).toEqual({ text: 'Hello world', filename: 'greeting.txt' })
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
    expect(block).toEqual({
      type: 'documentBlock',
      name: 'research.pdf',
      format: 'pdf',
      source: { bytes },
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
