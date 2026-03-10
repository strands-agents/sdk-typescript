/**
 * A2A server that exposes a Strands Agent as an A2A-compliant HTTP endpoint.
 *
 * Uses Express to serve the agent card and handle JSON-RPC requests.
 * The A2A protocol is experimental, so breaking changes in the underlying SDK
 * may require breaking changes in this module.
 */

import express, { type Router } from 'express'
import type { AgentCard, AgentSkill } from '@a2a-js/sdk'
import type { TaskStore, A2ARequestHandler } from '@a2a-js/sdk/server'
import { DefaultRequestHandler, InMemoryTaskStore } from '@a2a-js/sdk/server'
import { agentCardHandler, jsonRpcHandler, UserBuilder } from '@a2a-js/sdk/server/express'
import type { AgentBase } from '../agent/agent-base.js'
import { A2AExecutor } from './executor.js'
import { logExperimentalWarning } from './logging.js'
import { logger } from '../logging/logger.js'

/**
 * Configuration options for creating an A2AServer.
 */
export interface A2AServerConfig {
  /** The Strands Agent to serve via A2A protocol */
  agent: AgentBase
  /** Human-readable name for the agent */
  name: string
  /** Optional description of the agent's purpose */
  description?: string
  /** Host to bind the server to (default: '127.0.0.1') */
  host?: string
  /** Port to listen on (default: 9000) */
  port?: number
  /** Public URL override for the agent card */
  httpUrl?: string
  /** Version string for the agent card (default: '0.0.1') */
  version?: string
  /** Skills to advertise in the agent card */
  skills?: AgentSkill[]
  /** Task store for persisting task state */
  taskStore?: TaskStore
  /** User builder for authentication (default: no authentication) */
  userBuilder?: UserBuilder
}

/**
 * Wraps a Strands Agent and exposes it as an A2A-compliant HTTP endpoint.
 *
 * Serves the agent card at `/.well-known/agent-card.json` and handles
 * JSON-RPC requests at the root path. Streaming is not supported in this version.
 *
 * @example
 * ```typescript
 * import { Agent } from '@strands-agents/sdk'
 * import { A2AServer } from '@strands-agents/sdk/a2a'
 *
 * const agent = new Agent({ model: 'my-model' })
 * const server = new A2AServer({
 *   agent,
 *   name: 'My Agent',
 *   description: 'An agent that helps with tasks',
 * })
 *
 * await server.serve()
 * ```
 */
export class A2AServer {
  private _host: string
  private _port: number
  private _agentCard: AgentCard
  private _requestHandler: A2ARequestHandler
  private _userBuilder: UserBuilder | undefined

  /**
   * Creates a new A2AServer.
   *
   * @param config - Configuration for the server
   */
  constructor(config: A2AServerConfig) {
    this._host = config.host ?? '127.0.0.1'
    this._port = config.port ?? 9000
    const httpUrl = config.httpUrl ?? `http://${this._host}:${this._port}`

    this._agentCard = {
      name: config.name,
      description: config.description ?? '',
      version: config.version ?? '0.0.1',
      protocolVersion: '0.2.0',
      url: httpUrl,
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
      skills: config.skills ?? [],
      capabilities: {
        streaming: true,
      },
    }

    this._userBuilder = config.userBuilder

    const taskStore = config.taskStore ?? new InMemoryTaskStore()
    const executor = new A2AExecutor(config.agent)
    this._requestHandler = new DefaultRequestHandler(this._agentCard, taskStore, executor)
  }

  /**
   * Returns the agent card for this server.
   */
  get agentCard(): AgentCard {
    return this._agentCard
  }

  /**
   * Returns the port the server is configured to listen on.
   * After `serve()` resolves, this reflects the actual bound port
   * (useful when configured with port 0 for OS-assigned ports).
   */
  get port(): number {
    return this._port
  }

  /**
   * Creates an Express Router middleware for the A2A endpoints.
   *
   * Mounts:
   * - `GET /.well-known/agent-card.json` — Returns the agent card
   * - `POST /` — Handles A2A JSON-RPC requests
   *
   * Uses the A2A SDK's `agentCardHandler` and `jsonRpcHandler` middleware.
   *
   * @returns An Express Router with A2A endpoints mounted
   */
  createMiddleware(): Router {
    logExperimentalWarning()

    const router = express.Router()

    router.use('/.well-known/agent-card.json', agentCardHandler({ agentCardProvider: this._requestHandler }))

    router.use(
      '/',
      jsonRpcHandler({
        requestHandler: this._requestHandler,
        userBuilder: this._userBuilder ?? UserBuilder.noAuthentication,
      })
    )

    return router
  }

  /**
   * Starts the HTTP server and begins listening for A2A requests.
   *
   * @param options - Optional server options
   */
  async serve(options?: { signal?: AbortSignal }): Promise<void> {
    const app = express()
    app.use(this.createMiddleware())

    return new Promise<void>((resolve, reject) => {
      const server = app.listen(this._port, this._host, () => {
        const addr = server.address()
        if (addr && typeof addr === 'object') {
          this._port = addr.port
          this._agentCard.url = `http://${this._host}:${this._port}`
        }
        logger.info(`a2a server listening on http://${this._host}:${this._port}`)
        resolve()
      })

      server.on('error', reject)

      if (options?.signal) {
        options.signal.addEventListener(
          'abort',
          () => {
            server.close()
          },
          { once: true }
        )
      }
    })
  }
}
