import { describe, it, expect } from 'vitest'
import { httpRequest } from '../vended_tools/http_request/http-request.js'
import { Agent, BedrockModel } from '@strands-agents/sdk'
import { getMessageText } from './__fixtures__/model-test-helpers.js'
import { shouldRunTests } from './__fixtures__/model-test-helpers.js'

describe.skipIf(!(await shouldRunTests()))('httpRequest tool (integration)', () => {
  it('agent uses http_request tool to fetch weather from Open-Meteo', async () => {
    const agent = new Agent({
      model: new BedrockModel({ maxTokens: 500 }),
      tools: [httpRequest],
      printer: false,
    })

    const result = await agent.invoke('Call Open-Meteo to get the weather in NYC')

    // Verify agent made a request and returned weather information
    const lastMessage = agent.messages[agent.messages.length - 1]
    const text = getMessageText(lastMessage)
    expect(text.toLowerCase()).toMatch(/weather|temperature|forecast|nyc|new york/)

    // Verify the result structure
    expect(result.stopReason).toBe('endTurn')
    expect(result.lastMessage.role).toBe('assistant')
  })
})
