import { describe, it, expect } from 'vitest'
import { Message, TextBlock } from '@strands-agents/sdk'
import { collectIterator } from '$/sdk/__fixtures__/model-test-helpers.js'
import { bedrock } from '../__fixtures__/model-providers.js'

describe('Region Configuration', () => {
  const sayHighMessage = Message.fromMessageData({
    role: 'user',
    content: [new TextBlock('say hi')],
  })

  it('uses explicit region when provided', async () => {
    const provider = bedrock.createModel({
      region: 'us-east-1',
      maxTokens: 50,
    })

    // Validate region configuration by checking config.region() directly
    // Making an actual request doesn't guarantee the correct region is being used
    const regionResult = await provider['_client'].config.region()
    expect(regionResult).toBe('us-east-1')

    // ensure that invocation works
    await collectIterator(provider.stream([sayHighMessage]))
  })

  it('defaults to us-west-2 when no region provided and AWS SDK does not resolve one', async () => {
    const provider = bedrock.createModel({
      maxTokens: 50,
    })

    // Validate region defaults to us-west-2
    // Making an actual request doesn't guarantee the correct region is being used
    const regionResult = await provider['_client'].config.region()
    expect(regionResult).toBe('us-west-2')

    // ensure that invocation works
    await collectIterator(provider.stream([sayHighMessage]))
  })

  it('uses region from clientConfig when provided', async () => {
    const provider = bedrock.createModel({
      clientConfig: { region: 'ap-northeast-1' },
      maxTokens: 50,
    })

    // Validate clientConfig region is used
    // Making an actual request doesn't guarantee the correct region is being used
    const regionResult = await provider['_client'].config.region()
    expect(regionResult).toBe('ap-northeast-1')

    // ensure that invocation works
    await collectIterator(provider.stream([sayHighMessage]))
  })
})
