import type { Node } from './nodes.js'
import type { MultiAgentStreamEvent } from './events.js'
import type { NodeResult } from './state.js'

/**
 * Item produced by a running node: a streaming event, a completion signal, or an error.
 */
export type QueueItem =
  | { type: 'event'; node: Node; event: MultiAgentStreamEvent }
  | { type: 'result'; node: Node; result: NodeResult }
  | { type: 'error'; node: Node; error: Error }

/**
 * Async queue with promise-based notification.
 */
export class Queue {
  private readonly _items: QueueItem[] = []
  /** Resolve function for the pending wait() promise, if any. */
  private _notify?: (() => void) | undefined

  /** Push an item to the queue, waking any waiting consumer. */
  push(item: QueueItem): void {
    this._items.push(item)
    this._notify?.()
    this._notify = undefined
  }

  /** Wait until at least one item is available. */
  wait(): Promise<void> {
    if (this._items.length > 0) return Promise.resolve()
    return new Promise((resolve) => {
      this._notify = resolve
    })
  }

  /** Remove and return the next item, or undefined if empty. */
  shift(): QueueItem | undefined {
    return this._items.shift()
  }

  /**
   * Number of items in the queue.
   */
  get size(): number {
    return this._items.length
  }
}
