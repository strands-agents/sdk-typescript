import { describe, it, expectTypeOf } from 'vitest'
import { z } from 'zod'
import { tool } from '../tool-factory.js'

describe('tool()', () => {
  describe('derived tool', () => {
    const baseTool = tool({
      name: 'base',
      inputSchema: z.object({ url: z.string(), method: z.enum(['GET', 'POST']) }),
      callback: (input) => ({ fetched: input.url }),
    })

    it('infers input and return types from source tool', () => {
      const derived = tool({
        name: 'derived',
        inputSchema: baseTool,
        callback: (input) => ({ combined: `${input.method} ${input.url}` }),
      })

      expectTypeOf(derived.invoke).parameter(0).toEqualTypeOf<{ url: string; method: 'GET' | 'POST' }>()
      expectTypeOf(derived.invoke).returns.resolves.toEqualTypeOf<{ combined: string }>()
    })
  })
})
