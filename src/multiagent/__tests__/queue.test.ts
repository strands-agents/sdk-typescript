import { beforeEach, describe, expect, it } from 'vitest'
import { Queue } from '../queue.js'
import type { QueueItem } from '../queue.js'
import type { Node } from '../nodes.js'
import { NodeResult, Status } from '../state.js'

describe('Queue', () => {
  let queue: Queue
  let mockNode: Node

  beforeEach(() => {
    mockNode = { id: 'node-1' } as Node
    queue = new Queue()
  })

  describe('push and shift', () => {
    it('dequeues items in FIFO order', () => {
      const item1: QueueItem = {
        type: 'result',
        node: mockNode,
        result: new NodeResult({ nodeId: 'node-1', status: Status.COMPLETED, duration: 10 }),
      }
      const item2: QueueItem = { type: 'error', node: mockNode, error: new Error('fail') }

      queue.push(item1)
      queue.push(item2)

      expect(queue.shift()).toBe(item1)
      expect(queue.shift()).toBe(item2)
    })

    it('returns undefined when empty', () => {
      expect(queue.shift()).toBeUndefined()
    })
  })

  describe('size', () => {
    it('reflects the current number of items', () => {
      expect(queue.size).toBe(0)

      queue.push({ type: 'error', node: mockNode, error: new Error('a') })
      queue.push({ type: 'error', node: mockNode, error: new Error('b') })
      expect(queue.size).toBe(2)

      queue.shift()
      expect(queue.size).toBe(1)
    })
  })

  describe('wait', () => {
    it('resolves immediately when items are available', async () => {
      queue.push({ type: 'error', node: mockNode, error: new Error('a') })

      await queue.wait()

      expect(queue.size).toBe(1)
    })

    it('blocks until an item is pushed', async () => {
      let resolved = false

      const waiting = queue.wait().then(() => {
        resolved = true
      })

      await Promise.resolve()
      expect(resolved).toBe(false)

      queue.push({ type: 'error', node: mockNode, error: new Error('a') })

      await waiting
      expect(resolved).toBe(true)
    })
  })
})
