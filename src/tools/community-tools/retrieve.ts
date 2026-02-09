import { FunctionTool } from '../function-tool.js'
import type { JSONValue } from '../../types/json.js'
import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
  type KnowledgeBaseRetrievalResult,
  type RetrieveResponse,
} from '@aws-sdk/client-bedrock-agent-runtime'

interface RetrieveInput {
  text: string
  numberOfResults?: number
  knowledgeBaseId?: string
  region?: string
  score?: number
  enableMetadata?: boolean
  retrieveFilter?: Record<string, unknown>
}

function successResult(text: string): JSONValue {
  return { status: 'success', content: [{ text }] }
}

function errorResult(text: string): JSONValue {
  return { status: 'error', content: [{ text }] }
}

const DEFAULT_KB_ID = globalThis?.process?.env?.KNOWLEDGE_BASE_ID
const DEFAULT_REGION = globalThis?.process?.env?.AWS_REGION ?? 'us-west-2'
const DEFAULT_MIN_SCORE = 0.4

function filterByScore(results: KnowledgeBaseRetrievalResult[], minScore: number): KnowledgeBaseRetrievalResult[] {
  return results.filter((result) => (result.score ?? 0) >= minScore)
}

function formatResults(data: RetrieveResponse, minScore: number, enableMetadata: boolean): string {
  const results = data.retrievalResults ?? []
  const filtered = filterByScore(results, minScore)
  if (filtered.length === 0) {
    return 'No results found above score threshold.'
  }

  const lines: string[] = []
  for (const result of filtered) {
    const docId = result.location?.customDocumentLocation?.id ?? result.location?.s3Location?.uri ?? 'Unknown'
    const score = result.score ?? 0
    lines.push(`\nScore: ${score.toFixed(4)}`)
    lines.push(`Document ID: ${docId}`)
    if (result.content?.text) {
      lines.push(`Content: ${result.content.text}\n`)
    }
    if (enableMetadata && result.metadata) {
      lines.push(`Metadata: ${JSON.stringify(result.metadata)}`)
    }
  }
  return lines.join('\n')
}

async function runRetrieve(input: RetrieveInput): Promise<JSONValue> {
  const query = input.text
  if (!query) {
    return errorResult('Missing required field: text')
  }

  const kbId = input.knowledgeBaseId ?? DEFAULT_KB_ID
  if (!kbId) {
    return errorResult('No knowledge_base_id provided and could not derive from environment (KNOWLEDGE_BASE_ID)')
  }

  const region = input.region ?? DEFAULT_REGION
  const numberOfResults = input.numberOfResults ?? 10
  const minScore = input.score ?? DEFAULT_MIN_SCORE
  const enableMetadata = input.enableMetadata ?? false
  const retrieveFilter = input.retrieveFilter

  const client = new BedrockAgentRuntimeClient({ region })
  try {
    const response = await client.send(
      new RetrieveCommand({
        knowledgeBaseId: kbId,
        retrievalQuery: { text: query },
        retrievalConfiguration: {
          vectorSearchConfiguration: {
            numberOfResults,
            ...(retrieveFilter ? { filter: retrieveFilter as never } : {}),
          },
        },
      })
    )

    const filtered = filterByScore(response.retrievalResults ?? [], minScore)
    const formatted = formatResults(response, minScore, enableMetadata)
    return successResult(`Retrieved ${filtered.length} results with score >= ${minScore}:\n${formatted}`)
  } catch (error) {
    return errorResult(`Error during retrieval: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export const retrieve = new FunctionTool({
  name: 'retrieve',
  description:
    'Retrieve relevant knowledge from an Amazon Bedrock Knowledge Base via semantic search. Requires KNOWLEDGE_BASE_ID or knowledgeBaseId.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Query text for semantic search' },
      numberOfResults: { type: 'number', description: 'Max results to return (default 10)' },
      knowledgeBaseId: { type: 'string', description: 'Knowledge base ID (default: env KNOWLEDGE_BASE_ID)' },
      region: { type: 'string', description: 'AWS region (default: env AWS_REGION or us-west-2)' },
      score: { type: 'number', description: 'Minimum relevance score 0-1 (default 0.4)' },
      enableMetadata: { type: 'boolean', description: 'Include metadata in response' },
      retrieveFilter: { type: 'object', description: 'Optional metadata filter' },
    },
    required: ['text'],
  },
  callback: (input: unknown): Promise<JSONValue> => runRetrieve((input ?? {}) as RetrieveInput),
})
