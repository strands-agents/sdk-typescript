import { describe, it, expect } from 'vitest'
import { httpRequest } from '@strands-agents/sdk/vended_tools/http_request'
import { Agent, BedrockModel } from '@strands-agents/sdk'
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
    expect(result.toString().toLowerCase()).toMatch(/weather|temperature|forecast|nyc|new york/)

    // Verify the result structure
    expect(result.stopReason).toBe('endTurn')
    expect(result.lastMessage.role).toBe('assistant')
  })
})
