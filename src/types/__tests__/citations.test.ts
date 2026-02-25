import { describe, expect, it } from 'vitest'
import { CitationsBlock, type CitationsBlockData } from '../citations.js'

describe('CitationsBlock', () => {
  const documentCharData: CitationsBlockData = {
    citations: [
      {
        location: { type: 'documentChar', documentIndex: 0, start: 10, end: 50 },
        sourceContent: [{ text: 'source text from document' }],
        title: 'Test Document',
      },
    ],
    content: [{ text: 'generated text with citation' }],
  }

  it('creates block with correct type discriminator', () => {
    const block = new CitationsBlock(documentCharData)
    expect(block.type).toBe('citationsBlock')
  })

  it('stores citations and content', () => {
    const block = new CitationsBlock(documentCharData)
    expect(block.citations).toStrictEqual(documentCharData.citations)
    expect(block.content).toStrictEqual(documentCharData.content)
  })

  describe('toJSON/fromJSON round-trips', () => {
    it('round-trips with documentChar location', () => {
      const original = new CitationsBlock(documentCharData)
      const restored = CitationsBlock.fromJSON(original.toJSON())
      expect(restored).toEqual(original)
    })

    it('round-trips with documentPage location', () => {
      const data: CitationsBlockData = {
        citations: [
          {
            location: { type: 'documentPage', documentIndex: 1, start: 3, end: 7 },
            sourceContent: [{ text: 'page content' }],
          },
        ],
        content: [{ text: 'generated from pages' }],
      }
      const original = new CitationsBlock(data)
      const restored = CitationsBlock.fromJSON(original.toJSON())
      expect(restored).toEqual(original)
    })

    it('round-trips with documentChunk location', () => {
      const data: CitationsBlockData = {
        citations: [
          {
            location: { type: 'documentChunk', documentIndex: 0, start: 0, end: 2 },
            sourceContent: [{ text: 'chunk content' }],
          },
        ],
        content: [{ text: 'generated from chunks' }],
      }
      const original = new CitationsBlock(data)
      const restored = CitationsBlock.fromJSON(original.toJSON())
      expect(restored).toEqual(original)
    })

    it('round-trips with searchResult location', () => {
      const data: CitationsBlockData = {
        citations: [
          {
            location: { type: 'searchResult', searchResultIndex: 2, start: 0, end: 100 },
            sourceContent: [{ text: 'search result content' }],
          },
        ],
        content: [{ text: 'generated from search' }],
      }
      const original = new CitationsBlock(data)
      const restored = CitationsBlock.fromJSON(original.toJSON())
      expect(restored).toEqual(original)
    })

    it('round-trips with web location', () => {
      const data: CitationsBlockData = {
        citations: [
          {
            location: { type: 'web', url: 'https://example.com/article' },
            sourceContent: [{ text: 'web content' }],
            title: 'Example Article',
          },
        ],
        content: [{ text: 'generated from web' }],
      }
      const original = new CitationsBlock(data)
      const restored = CitationsBlock.fromJSON(original.toJSON())
      expect(restored).toEqual(original)
    })
  })

  it('handles optional title field', () => {
    const withTitle = new CitationsBlock(documentCharData)
    expect(withTitle.citations[0]!.title).toBe('Test Document')

    const withoutTitle = new CitationsBlock({
      citations: [
        {
          location: { type: 'documentChar', documentIndex: 0, start: 0, end: 10 },
          sourceContent: [{ text: 'source' }],
        },
      ],
      content: [{ text: 'generated' }],
    })
    expect(withoutTitle.citations[0]!.title).toBeUndefined()
  })

  it('handles empty arrays', () => {
    const data: CitationsBlockData = {
      citations: [],
      content: [],
    }
    const block = new CitationsBlock(data)
    expect(block.citations).toStrictEqual([])
    expect(block.content).toStrictEqual([])

    const restored = CitationsBlock.fromJSON(block.toJSON())
    expect(restored).toEqual(block)
  })

  it('toJSON returns wrapped format', () => {
    const block = new CitationsBlock(documentCharData)
    const json = block.toJSON()
    expect(json).toStrictEqual({
      citationsContent: {
        citations: documentCharData.citations,
        content: documentCharData.content,
      },
    })
  })

  it('works with JSON.stringify', () => {
    const original = new CitationsBlock(documentCharData)
    const jsonString = JSON.stringify(original)
    const restored = CitationsBlock.fromJSON(JSON.parse(jsonString))
    expect(restored).toEqual(original)
  })

  it('handles multiple citations and content blocks', () => {
    const data: CitationsBlockData = {
      citations: [
        {
          location: { type: 'documentChar', documentIndex: 0, start: 0, end: 50 },
          sourceContent: [{ text: 'first source' }],
          title: 'Doc 1',
        },
        {
          location: { type: 'documentPage', documentIndex: 1, start: 1, end: 3 },
          sourceContent: [{ text: 'second source' }, { text: 'additional source' }],
        },
      ],
      content: [{ text: 'first generated' }, { text: 'second generated' }],
    }
    const original = new CitationsBlock(data)
    const restored = CitationsBlock.fromJSON(original.toJSON())
    expect(restored).toEqual(original)
  })

  it('round-trips all CitationLocation union variants in a single block', () => {
    const data: CitationsBlockData = {
      citations: [
        {
          location: { type: 'documentChar', documentIndex: 0, start: 150, end: 300 },
          sourceContent: [{ text: 'char source' }],
          title: 'Text Document',
        },
        {
          location: { type: 'documentPage', documentIndex: 0, start: 2, end: 3 },
          sourceContent: [{ text: 'page source' }],
          title: 'PDF Document',
        },
        {
          location: { type: 'documentChunk', documentIndex: 1, start: 5, end: 8 },
          sourceContent: [{ text: 'chunk source' }],
          title: 'Chunked Document',
        },
        {
          location: { type: 'searchResult', searchResultIndex: 0, start: 25, end: 150 },
          sourceContent: [{ text: 'search source' }],
          title: 'Search Result',
        },
        {
          location: { type: 'web', url: 'https://example.com/doc', domain: 'example.com' },
          sourceContent: [{ text: 'web source' }],
          title: 'Web Page',
        },
      ],
      content: [{ text: 'generated text referencing all sources' }],
    }
    const original = new CitationsBlock(data)
    const json = original.toJSON()
    const restored = CitationsBlock.fromJSON(json)

    expect(restored).toEqual(original)
    expect(restored.citations).toHaveLength(5)

    // Verify each variant has the correct type discriminator
    expect(restored.citations[0]!.location.type).toBe('documentChar')
    expect(restored.citations[1]!.location.type).toBe('documentPage')
    expect(restored.citations[2]!.location.type).toBe('documentChunk')
    expect(restored.citations[3]!.location.type).toBe('searchResult')
    expect(restored.citations[4]!.location.type).toBe('web')
  })

  it('preserves optional source and domain fields', () => {
    const data: CitationsBlockData = {
      citations: [
        {
          location: { type: 'web', url: 'https://example.com', domain: 'example.com' },
          source: 'web-source-id',
          sourceContent: [{ text: 'web content' }],
          title: 'Example',
        },
      ],
      content: [{ text: 'generated' }],
    }
    const block = new CitationsBlock(data)
    expect(block.citations[0]!.source).toBe('web-source-id')

    const restored = CitationsBlock.fromJSON(block.toJSON())
    expect(restored.citations[0]!.source).toBe('web-source-id')
    const loc = restored.citations[0]!.location
    expect(loc.type).toBe('web')
    if (loc.type === 'web') {
      expect(loc.domain).toBe('example.com')
    }
  })
})
