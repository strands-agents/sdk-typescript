import type { JSONSerializable, Serialized } from './json.js'

/**
 * Citation types for document citation content blocks.
 *
 * Citations are returned by models (particularly Bedrock) when document citations
 * are enabled. They are output-only blocks that appear in conversation history.
 */

/**
 * Location referencing character positions within a document.
 */
export interface DocumentCharLocation {
  /**
   * Index of the source document.
   */
  documentIndex: number

  /**
   * Start character position.
   */
  start: number

  /**
   * End character position.
   */
  end: number
}

/**
 * Location referencing page positions within a document.
 */
export interface DocumentPageLocation {
  /**
   * Index of the source document.
   */
  documentIndex: number

  /**
   * Start page number.
   */
  start: number

  /**
   * End page number.
   */
  end: number
}

/**
 * Location referencing chunk positions within a document.
 */
export interface DocumentChunkLocation {
  /**
   * Index of the source document.
   */
  documentIndex: number

  /**
   * Start chunk index.
   */
  start: number

  /**
   * End chunk index.
   */
  end: number
}

/**
 * Location referencing a search result.
 */
export interface SearchResultLocation {
  /**
   * Index of the search result.
   */
  searchResultIndex: number

  /**
   * Start position within the search result.
   */
  start: number

  /**
   * End position within the search result.
   */
  end: number
}

/**
 * Location referencing a web URL.
 */
export interface WebLocation {
  /**
   * The URL of the web source.
   */
  url: string
}

/**
 * Discriminated union of citation location types.
 * Each variant uses a unique object key to identify the location type.
 */
export type CitationLocation =
  | { documentChar: DocumentCharLocation }
  | { documentPage: DocumentPageLocation }
  | { documentChunk: DocumentChunkLocation }
  | { searchResult: SearchResultLocation }
  | { web: WebLocation }

/**
 * Source content referenced by a citation.
 */
export interface CitationSourceContent {
  /**
   * The text content from the source.
   */
  text: string
}

/**
 * Generated content associated with a citation.
 */
export interface CitationGeneratedContent {
  /**
   * The generated text content.
   */
  text: string
}

/**
 * A single citation linking generated content to a source location.
 */
export interface Citation {
  /**
   * The location of the cited source.
   */
  location: CitationLocation

  /**
   * The source content referenced by this citation.
   */
  sourceContent: CitationSourceContent[]

  /**
   * Optional title of the cited source.
   */
  title?: string
}

/**
 * Data for a citations content block.
 */
export interface CitationsBlockData {
  /**
   * Array of citations linking generated content to source locations.
   */
  citations: Citation[]

  /**
   * The generated content associated with these citations.
   */
  content: CitationGeneratedContent[]
}

/**
 * Citations content block within a message.
 * Returned by models when document citations are enabled.
 * This is an output-only block — users do not construct these directly.
 */
export class CitationsBlock
  implements CitationsBlockData, JSONSerializable<{ citationsContent: Serialized<CitationsBlockData> }>
{
  /**
   * Discriminator for citations content.
   */
  readonly type = 'citationsBlock' as const

  /**
   * Array of citations linking generated content to source locations.
   */
  readonly citations: Citation[]

  /**
   * The generated content associated with these citations.
   */
  readonly content: CitationGeneratedContent[]

  constructor(data: CitationsBlockData) {
    this.citations = data.citations
    this.content = data.content
  }

  /**
   * Serializes the CitationsBlock to a JSON-compatible ContentBlockData object.
   * Called automatically by JSON.stringify().
   */
  toJSON(): { citationsContent: Serialized<CitationsBlockData> } {
    return {
      citationsContent: {
        citations: this.citations,
        content: this.content,
      },
    }
  }

  /**
   * Creates a CitationsBlock instance from its wrapped data format.
   *
   * @param data - Wrapped CitationsBlockData to deserialize
   * @returns CitationsBlock instance
   */
  static fromJSON(data: { citationsContent: Serialized<CitationsBlockData> }): CitationsBlock {
    return new CitationsBlock(data.citationsContent)
  }
}
