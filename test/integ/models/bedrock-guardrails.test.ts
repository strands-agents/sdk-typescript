import { beforeAll, describe, expect, it } from 'vitest'
import { Agent, Message, TextBlock, FunctionTool, FileStorage, SessionManager } from '@strands-agents/sdk'
import type { MessageData } from '@strands-agents/sdk'
import { bedrock } from '../__fixtures__/model-providers.js'
import { mkdtemp } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  BedrockClient,
  CreateGuardrailCommand,
  GetGuardrailCommand,
  ListGuardrailsCommand,
} from '@aws-sdk/client-bedrock'
import { inject } from 'vitest'

const BLOCKED_INPUT = 'BLOCKED_INPUT'
const BLOCKED_OUTPUT = 'BLOCKED_OUTPUT'
const GUARDRAIL_NAME = 'test-guardrail-block-cactus'

let GUARDRAIL_ID: string | undefined

/**
 * Gets the guardrail ID by name if it exists
 */
async function getGuardrailId(client: BedrockClient, guardrailName: string): Promise<string | undefined> {
  const response = await client.send(new ListGuardrailsCommand({}))
  const guardrail = response.guardrails?.find((g) => g.name === guardrailName)
  return guardrail?.id
}

/**
 * Waits for the guardrail to become active
 */
async function waitForGuardrailActive(
  client: BedrockClient,
  guardrailId: string,
  maxAttempts = 10,
  delayMs = 5000
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    const response = await client.send(new GetGuardrailCommand({ guardrailIdentifier: guardrailId }))
    const status = response.status

    if (status === 'READY') {
      console.log(`Guardrail ${guardrailId} is now active`)
      return
    }

    console.log(`Waiting for guardrail to become active. Current status: ${status}`)
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }

  throw new Error(`Guardrail did not become active within ${(maxAttempts * delayMs) / 1000} seconds`)
}

/**
 * Creates or retrieves the test guardrail
 */
async function setupGuardrail(): Promise<string> {
  const credentials = inject('provider-bedrock')?.credentials
  if (!credentials) {
    throw new Error('No Bedrock credentials provided')
  }

  const client = new BedrockClient({ region: 'us-east-1', credentials })

  // Check if guardrail already exists
  let guardrailId = await getGuardrailId(client, GUARDRAIL_NAME)

  if (guardrailId) {
    console.log(`Guardrail ${GUARDRAIL_NAME} already exists with ID: ${guardrailId}`)
  } else {
    console.log(`Creating guardrail ${GUARDRAIL_NAME}`)
    const response = await client.send(
      new CreateGuardrailCommand({
        name: GUARDRAIL_NAME,
        description: 'Testing Guardrail',
        wordPolicyConfig: {
          wordsConfig: [
            {
              text: 'CACTUS',
            },
          ],
        },
        blockedInputMessaging: BLOCKED_INPUT,
        blockedOutputsMessaging: BLOCKED_OUTPUT,
      })
    )
    guardrailId = response.guardrailId
    if (!guardrailId) {
      throw new Error('Failed to create guardrail: no ID returned')
    }
    console.log(`Created test guardrail with ID: ${guardrailId}`)
    await waitForGuardrailActive(client, guardrailId)
  }

  if (!guardrailId) {
    throw new Error('Failed to get or create guardrail')
  }

  return guardrailId
}

const shouldSkip = bedrock.skip

describe.skipIf(shouldSkip)('BedrockModel Guardrails Integration Tests', () => {
  beforeAll(async () => {
    GUARDRAIL_ID = await setupGuardrail()
  }, 60000)

  describe('Input Intervention', () => {
    it.each(['enabled', 'enabled_full'] as const)(
      'blocks input and redacts message with trace=%s',
      async (guardrailTrace) => {
        const model = bedrock.createModel({
          guardrailConfig: {
            guardrailIdentifier: GUARDRAIL_ID!,
            guardrailVersion: 'DRAFT',
            trace: guardrailTrace,
            redaction: {
              input: true,
              inputMessage: 'Redacted.',
            },
          },
        })

        const agent = new Agent({
          model,
          systemPrompt: 'You are a helpful assistant.',
          printer: false,
        })

        const response1 = await agent.invoke('CACTUS')
        const response2 = await agent.invoke('Hello!')

        expect(response1.stopReason).toBe('guardrailIntervened')
        expect(response1.toString().trim()).toBe(BLOCKED_INPUT)
        expect(response2.stopReason).not.toBe('guardrailIntervened')
        expect(response2.toString().trim()).not.toBe(BLOCKED_INPUT)
        expect(agent.messages[0]?.content[0]?.type).toBe('textBlock')
        const firstBlock = agent.messages[0]?.content[0]
        if (firstBlock?.type === 'textBlock') {
          expect(firstBlock.text).toBe('Redacted.')
        }
      },
      30000
    )
  })

  describe('Output Intervention', () => {
    it.each(['sync', 'async'] as const)(
      'blocks output without redaction in %s mode',
      async (processingMode) => {
        const model = bedrock.createModel({
          guardrailConfig: {
            guardrailIdentifier: GUARDRAIL_ID!,
            guardrailVersion: 'DRAFT',
            streamProcessingMode: processingMode,
            redaction: {
              output: false,
            },
          },
        })

        const agent = new Agent({
          model,
          systemPrompt: 'When asked to say the word, say CACTUS.',
          printer: false,
        })

        const response1 = await agent.invoke('Say the word.')
        const response2 = await agent.invoke('Hello!')

        expect(response1.stopReason).toBe('guardrailIntervened')

        if (processingMode === 'sync') {
          // In sync mode, we can reliably check the response content
          expect(response1.toString()).toContain(BLOCKED_OUTPUT)
          expect(response2.stopReason).not.toBe('guardrailIntervened')
          expect(response2.toString()).not.toContain(BLOCKED_OUTPUT)
        } else {
          // In async mode, either:
          // - CACTUS was returned and blocked by input guardrail on next turn, or
          // - CACTUS was blocked in response1, allowing normal response2
          const cactusCaughtByInputGuardrail = response2.toString().includes(BLOCKED_INPUT)
          const cactusBlockedAllowsNextResponse =
            !response2.toString().includes(BLOCKED_OUTPUT) && response2.stopReason !== 'guardrailIntervened'
          expect(cactusCaughtByInputGuardrail || cactusBlockedAllowsNextResponse).toBe(true)
        }
      },
      30000
    )

    it.each([
      ['sync', 'enabled'],
      ['sync', 'enabled_full'],
      ['async', 'enabled'],
      ['async', 'enabled_full'],
    ] as const)(
      'blocks output with redaction in %s mode with trace=%s',
      async (processingMode, guardrailTrace) => {
        const REDACT_MESSAGE = 'Redacted.'
        const model = bedrock.createModel({
          guardrailConfig: {
            guardrailIdentifier: GUARDRAIL_ID!,
            guardrailVersion: 'DRAFT',
            streamProcessingMode: processingMode,
            trace: guardrailTrace,
            redaction: {
              output: true,
              outputMessage: REDACT_MESSAGE,
            },
          },
          temperature: 0, // Deterministic responses
        })

        const agent = new Agent({
          model,
          systemPrompt: 'When asked to say the word, say CACTUS. Otherwise, respond normally.',
          printer: false,
        })

        const response1 = await agent.invoke('Say the word.')
        // Use unrelated prompt to avoid model volunteering CACTUS
        const response2 = await agent.invoke('What is 2+2? Reply with only the number.')

        expect(response1.stopReason).toBe('guardrailIntervened')

        if (processingMode === 'sync') {
          expect(response1.toString()).toContain(REDACT_MESSAGE)
          expect(response2.stopReason).not.toBe('guardrailIntervened')
          expect(response2.toString()).not.toContain(REDACT_MESSAGE)
        } else {
          // In async mode, either:
          // - CACTUS was returned and blocked by input guardrail on next turn, or
          // - CACTUS was blocked in response1, allowing normal response2
          const cactusCaughtByInputGuardrail = response2.toString().includes(BLOCKED_INPUT)
          const cactusBlockedAllowsNextResponse =
            !response2.toString().includes(REDACT_MESSAGE) && response2.stopReason !== 'guardrailIntervened'
          expect(cactusCaughtByInputGuardrail || cactusBlockedAllowsNextResponse).toBe(true)
        }
      },
      30000
    )
  })

  describe('Tool Result Redaction', () => {
    it.each(['sync', 'async'] as const)(
      'properly redacts tool result in %s mode',
      async (processingMode) => {
        const INPUT_REDACT_MESSAGE = 'Input redacted.'
        const OUTPUT_REDACT_MESSAGE = 'Output redacted.'

        const model = bedrock.createModel({
          guardrailConfig: {
            guardrailIdentifier: GUARDRAIL_ID!,
            guardrailVersion: 'DRAFT',
            streamProcessingMode: processingMode,
            redaction: {
              input: true,
              inputMessage: INPUT_REDACT_MESSAGE,
              output: true,
              outputMessage: OUTPUT_REDACT_MESSAGE,
            },
          },
        })

        const listUsers = new FunctionTool({
          name: 'list_users',
          description: 'List my users',
          inputSchema: { type: 'object', properties: {} },
          callback: async () => {
            return '[{"name": "Jerry Merry"}, {"name": "Mr. CACTUS"}]'
          },
        })

        const agent = new Agent({
          model,
          systemPrompt: 'You are a helpful assistant.',
          tools: [listUsers],
          printer: false,
        })

        const response1 = await agent.invoke('List my users.')
        const response2 = await agent.invoke('Thank you!')

        /*
         * Message sequence:
         * 0 (user): request1
         * 1 (assistant): reasoning + tool call
         * 2 (user): tool result
         * 3 (assistant): response1 -> output guardrail intervenes
         * 4 (user): request2
         * 5 (assistant): response2
         *
         * Guardrail intervened on output in message 3 will cause
         * the redaction of the preceding input (message 2) and message 3.
         */

        expect(response1.stopReason).toBe('guardrailIntervened')

        if (processingMode === 'sync') {
          // In sync mode the guardrail processing is blocking
          expect(response1.toString()).toContain(OUTPUT_REDACT_MESSAGE)
          expect(response2.toString()).not.toContain(OUTPUT_REDACT_MESSAGE)
        }

        // In both sync and async with output redaction:
        // 1. Content should be properly redacted so response2 is not blocked
        expect(response2.stopReason).not.toBe('guardrailIntervened')

        // 2. Tool result block should be redacted properly
        const toolUseMessage = agent.messages[1]
        const toolResultMessage = agent.messages[2]

        expect(toolUseMessage).toBeDefined()
        expect(toolResultMessage).toBeDefined()

        const toolUseBlock = toolUseMessage?.content.find((b) => b.type === 'toolUseBlock')
        const toolResultBlock = toolResultMessage?.content.find((b) => b.type === 'toolResultBlock')

        expect(toolUseBlock).toBeDefined()
        expect(toolResultBlock).toBeDefined()

        if (toolUseBlock?.type === 'toolUseBlock' && toolResultBlock?.type === 'toolResultBlock') {
          expect(toolResultBlock.toolUseId).toBe(toolUseBlock.toolUseId)
          const firstContent = toolResultBlock.content[0]
          expect(firstContent).toBeDefined()
          if (firstContent?.type === 'textBlock') {
            expect((firstContent as TextBlock).text).toBe(INPUT_REDACT_MESSAGE)
          }
        }
      },
      30000
    )
  })

  describe('Session Persistence', () => {
    it('properly redacts input in session', async () => {
      const model = bedrock.createModel({
        guardrailConfig: {
          guardrailIdentifier: GUARDRAIL_ID!,
          guardrailVersion: 'DRAFT',
          redaction: {
            input: true,
            inputMessage: 'BLOCKED!',
          },
        },
      })

      const testSessionId = `test-session-${Date.now()}`
      const tempDir = await mkdtemp(join(tmpdir(), 'bedrock-guardrail-test-'))
      const storage = new FileStorage(tempDir)
      const sessionManager = new SessionManager({
        sessionId: testSessionId,
        storage: { snapshot: storage },
        saveLatestOn: 'message',
      })

      const agent = new Agent({
        model,
        systemPrompt: 'You are a helpful assistant.',
        sessionManager,
        printer: false,
      })

      const response1 = await agent.invoke('CACTUS')

      expect(response1.stopReason).toBe('guardrailIntervened')
      const firstBlock = agent.messages[0]?.content[0]
      if (firstBlock?.type === 'textBlock') {
        expect(firstBlock.text).toBe('BLOCKED!')
      }

      // Load snapshot to verify persisted message is redacted
      const snapshot = await storage.loadSnapshot({
        location: { sessionId: testSessionId, scope: 'agent', scopeId: agent.agentId },
      })
      expect(snapshot).toBeDefined()
      const snapshotMessages = snapshot?.data.messages as MessageData[] | undefined
      expect(snapshotMessages).toBeDefined()
      expect(snapshotMessages?.[0]?.content[0]).toBeDefined()
      const firstContentBlock = snapshotMessages?.[0]?.content[0]
      if (firstContentBlock && 'text' in firstContentBlock) {
        expect(firstContentBlock.text).toBe('BLOCKED!')
      }

      // Restore agent from session and confirm input is still redacted
      const agent2 = new Agent({
        model,
        systemPrompt: 'You are a helpful assistant.',
        sessionManager,
        printer: false,
      })

      const restored = await sessionManager.restoreSnapshot({ target: agent2 })
      expect(restored).toBe(true)

      expect(agent2.messages[0]?.content[0]?.type).toBe('textBlock')
      const agent2FirstBlock = agent2.messages[0]?.content[0]
      if (agent2FirstBlock?.type === 'textBlock') {
        expect(agent2FirstBlock.text).toBe('BLOCKED!')
      }
      expect(agent.messages[0]).toEqual(agent2.messages[0])
    }, 30000)
  })
})
