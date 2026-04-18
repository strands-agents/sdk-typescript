import { AfterModelCallEvent, AfterInvocationEvent } from '../hooks/events.js'
import { logger } from '../logging/logger.js'

export class ExponentialBackoff {
  public initialDelay: number
  public maxDelay: number

  constructor({
    initialDelay = 1000,
    maxDelay = 30000,
  }: {
    initialDelay?: number
    maxDelay?: number
  } = {}) {
    this.initialDelay = initialDelay
    this.maxDelay = maxDelay
  }
}

export interface RetryStrategyConfig {
  maxAttempts?: number
  backoff?: ExponentialBackoff
  retryOn?: string[]
}

const DEFAULT_MAX_ATTEMPTS = 6
const DEFAULT_RETRY_ON = ['ModelThrottledError']

/**
 * Underlying strategy instance that evaluates responses and applies backoff sleeps per Python SDK internal architecture.
 */
export class ModelRetryStrategy {
  private readonly _maxAttempts: number
  private readonly _backoff: ExponentialBackoff
  private readonly _retryOn: string[]
  private _currentAttempt: number = 0

  constructor(config?: RetryStrategyConfig) {
    this._maxAttempts = config?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
    this._backoff = config?.backoff ?? new ExponentialBackoff()
    this._retryOn = config?.retryOn ?? DEFAULT_RETRY_ON
  }

  /**
   * Calculate retry delay using exponential backoff.
   * Formula: initialDelay * (2 ^ attempt), capped at maxDelay.
   *
   * @internal
   */
  _calculateDelay(attempt: number): number {
    const delay = this._backoff.initialDelay * Math.pow(2, attempt)
    return Math.min(delay, this._backoff.maxDelay)
  }

  private _resetRetryState(): void {
    this._currentAttempt = 0
  }

  public async handleAfterModelCall(event: AfterModelCallEvent): Promise<void> {
    const delay = this._calculateDelay(this._currentAttempt)

    if (event.retry) {
      return
    }

    if (event.stopData != null) {
      this._resetRetryState()
      return
    }

    if (event.error == null) {
      this._resetRetryState()
      return
    }

    // Only retry if the error name matches an entry in retryOn
    if (!this._retryOn.includes(event.error.name)) {
      this._resetRetryState()
      return
    }

    this._currentAttempt += 1

    if (this._currentAttempt >= this._maxAttempts) {
      logger.debug('max retry attempts reached, not retrying')
      return
    }

    logger.debug(
      `delay=<${delay}>, attempt=<${this._currentAttempt}>, max_attempts=<${this._maxAttempts}> | model throttled, retrying API call`
    )
    await sleep(delay)
    event.retry = true
  }

  public async handleAfterInvocation(_event: AfterInvocationEvent): Promise<void> {
    this._resetRetryState()
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
