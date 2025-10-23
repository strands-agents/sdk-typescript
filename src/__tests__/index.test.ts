import { describe, it } from 'vitest'

describe('index.ts', () => {
  it('can be imported without error', async () => {
    await import('../index')
  })
})
