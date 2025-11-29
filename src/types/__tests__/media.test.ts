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

describe('S3Location.toString', () => {
  it('returns JSON string representation with uri', () => {
    const location = new S3Location({
      uri: 's3://my-bucket/image.jpg',
    })

    const result = location.toString()
    const parsed = JSON.parse(result)

    expect(parsed.uri).toBe('s3://my-bucket/image.jpg')
  })

  it('includes optional bucketOwner field', () => {
    const location = new S3Location({
      uri: 's3://my-bucket/doc.pdf',
      bucketOwner: '123456789012',
    })

    const result = location.toString()
    const parsed = JSON.parse(result)

    expect(parsed.uri).toBe('s3://my-bucket/doc.pdf')
    expect(parsed.bucketOwner).toBe('123456789012')
  })

  it('omits optional bucketOwner when not provided', () => {
    const location = new S3Location({
      uri: 's3://my-bucket/file.txt',
    })

    const result = location.toString()
    const parsed = JSON.parse(result)

    expect(parsed.bucketOwner).toBeUndefined()
  })

  it('returns valid JSON that can be parsed', () => {
    const location = new S3Location({
      uri: 's3://test-bucket/test.txt',
    })

    const result = location.toString()
    expect(() => JSON.parse(result)).not.toThrow()
  })
})

describe('ImageBlock.toString', () => {
  it('returns JSON string representation with type, format, and bytes source', () => {
    const block = new ImageBlock({
      format: 'jpeg',
      source: { bytes: new Uint8Array([1, 2, 3, 4]) },
    })

    const result = block.toString()
    const parsed = JSON.parse(result)

    expect(parsed.type).toBe('imageBlock')
    expect(parsed.format).toBe('jpeg')
    expect(parsed.source.type).toBe('imageSourceBytes')
    expect(parsed.source.bytes).toEqual({ '0': 1, '1': 2, '2': 3, '3': 4 })
  })

  it('returns JSON string representation with URL source', () => {
    const block = new ImageBlock({
      format: 'png',
      source: { url: 'https://example.com/image.png' },
    })

    const result = block.toString()
    const parsed = JSON.parse(result)

    expect(parsed.type).toBe('imageBlock')
    expect(parsed.format).toBe('png')
    expect(parsed.source.type).toBe('imageSourceUrl')
    expect(parsed.source.url).toBe('https://example.com/image.png')
  })

  it('returns JSON string representation with S3 location source', () => {
    const block = new ImageBlock({
      format: 'webp',
      source: {
        s3Location: {
          uri: 's3://my-bucket/image.webp',
          bucketOwner: '123456789012',
        },
      },
    })

    const result = block.toString()
    const parsed = JSON.parse(result)

    expect(parsed.type).toBe('imageBlock')
    expect(parsed.format).toBe('webp')
    expect(parsed.source.type).toBe('imageSourceS3Location')
    expect(parsed.source.s3Location.uri).toBe('s3://my-bucket/image.webp')
    expect(parsed.source.s3Location.bucketOwner).toBe('123456789012')
  })

  it('returns valid JSON that can be parsed', () => {
    const block = new ImageBlock({
      format: 'gif',
      source: { bytes: new Uint8Array([5, 6, 7]) },
    })

    const result = block.toString()
    expect(() => JSON.parse(result)).not.toThrow()
  })
})

describe('VideoBlock.toString', () => {
  it('returns JSON string representation with type, format, and bytes source', () => {
    const block = new VideoBlock({
      format: 'mp4',
      source: { bytes: new Uint8Array([10, 20, 30]) },
    })

    const result = block.toString()
    const parsed = JSON.parse(result)

    expect(parsed.type).toBe('videoBlock')
    expect(parsed.format).toBe('mp4')
    expect(parsed.source.type).toBe('videoSourceBytes')
    expect(parsed.source.bytes).toEqual({ '0': 10, '1': 20, '2': 30 })
  })

  it('returns JSON string representation with S3 location source', () => {
    const block = new VideoBlock({
      format: 'webm',
      source: {
        s3Location: {
          uri: 's3://video-bucket/video.webm',
        },
      },
    })

    const result = block.toString()
    const parsed = JSON.parse(result)

    expect(parsed.type).toBe('videoBlock')
    expect(parsed.format).toBe('webm')
    expect(parsed.source.type).toBe('videoSourceS3Location')
    expect(parsed.source.s3Location.uri).toBe('s3://video-bucket/video.webm')
  })

  it('returns valid JSON that can be parsed', () => {
    const block = new VideoBlock({
      format: 'mkv',
      source: { bytes: new Uint8Array([1, 2]) },
    })

    const result = block.toString()
    expect(() => JSON.parse(result)).not.toThrow()
  })
})

describe('DocumentBlock.toString', () => {
  it('returns JSON string representation with type, name, format, and bytes source', () => {
    const block = new DocumentBlock({
      name: 'document.pdf',
      format: 'pdf',
      source: { bytes: new Uint8Array([100, 101, 102]) },
    })

    const result = block.toString()
    const parsed = JSON.parse(result)

    expect(parsed.type).toBe('documentBlock')
    expect(parsed.name).toBe('document.pdf')
    expect(parsed.format).toBe('pdf')
    expect(parsed.source.type).toBe('documentSourceBytes')
    expect(parsed.source.bytes).toEqual({ '0': 100, '1': 101, '2': 102 })
  })

  it('returns JSON string representation with text source', () => {
    const block = new DocumentBlock({
      name: 'readme.txt',
      format: 'txt',
      source: { text: 'This is the content of the document.' },
    })

    const result = block.toString()
    const parsed = JSON.parse(result)

    expect(parsed.type).toBe('documentBlock')
    expect(parsed.name).toBe('readme.txt')
    expect(parsed.format).toBe('txt')
    expect(parsed.source.type).toBe('documentSourceText')
    expect(parsed.source.text).toBe('This is the content of the document.')
  })

  it('returns JSON string representation with S3 location source', () => {
    const block = new DocumentBlock({
      name: 'report.docx',
      format: 'docx',
      source: {
        s3Location: {
          uri: 's3://docs-bucket/report.docx',
          bucketOwner: '987654321098',
        },
      },
    })

    const result = block.toString()
    const parsed = JSON.parse(result)

    expect(parsed.type).toBe('documentBlock')
    expect(parsed.source.type).toBe('documentSourceS3Location')
    expect(parsed.source.s3Location.uri).toBe('s3://docs-bucket/report.docx')
    expect(parsed.source.s3Location.bucketOwner).toBe('987654321098')
  })

  it('includes optional citations and context fields', () => {
    const block = new DocumentBlock({
      name: 'research.pdf',
      format: 'pdf',
      source: { text: 'Research content' },
      citations: { enabled: true },
      context: 'This is a research paper',
    })

    const result = block.toString()
    const parsed = JSON.parse(result)

    expect(parsed.citations).toEqual({ enabled: true })
    expect(parsed.context).toBe('This is a research paper')
  })

  it('omits optional fields when not provided', () => {
    const block = new DocumentBlock({
      name: 'simple.txt',
      format: 'txt',
      source: { text: 'Content' },
    })

    const result = block.toString()
    const parsed = JSON.parse(result)

    expect(parsed.citations).toBeUndefined()
    expect(parsed.context).toBeUndefined()
  })

  it('returns valid JSON that can be parsed', () => {
    const block = new DocumentBlock({
      name: 'test.md',
      format: 'md',
      source: { text: '# Title\nContent' },
    })

    const result = block.toString()
    expect(() => JSON.parse(result)).not.toThrow()
  })
})
