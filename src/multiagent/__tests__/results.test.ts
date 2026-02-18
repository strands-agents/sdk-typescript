import { describe, expect, it } from 'vitest'
import { NodeResult } from '../results.js'
import { Status } from '../status.js'
import { TextBlock } from '../../types/messages.js'

describe('NodeResult', () => {
  it('constructs with COMPLETED status', () => {
    const content = [new TextBlock('hello')]
    const result = new NodeResult({
      nodeId: 'node-1',
      status: Status.COMPLETED,
      duration: 1.5,
      content,
    })

    expect(result).toStrictEqual(
      expect.objectContaining({
        type: 'nodeResult',
        nodeId: 'node-1',
        status: Status.COMPLETED,
        duration: 1.5,
        content,
      })
    )
    expect(result.error).toBeUndefined()
  })

  it('constructs with FAILED status and error', () => {
    const error = new Error('something broke')
    const result = new NodeResult({
      nodeId: 'node-2',
      status: Status.FAILED,
      duration: 0.3,
      content: [],
      error,
    })

    expect(result.status).toBe(Status.FAILED)
    expect(result.error).toBe(error)
  })

  it('defaults content to empty array when omitted', () => {
    const result = new NodeResult({
      nodeId: 'node-3',
      status: Status.PENDING,
      duration: 0,
    })

    expect(result.content).toStrictEqual([])
  })
})
