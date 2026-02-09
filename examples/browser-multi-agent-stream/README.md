# Strands Agents Playground

A browser UI to configure and run agent workflows (Single, Swarm, or Graph) with live streaming, execution timeline, and metrics. You can customize agents, system prompts, orchestration mode, and (in Graph mode) edges and entry points.

## Prerequisites

- Node 20+
- AWS credentials for **Bedrock** (same as other Bedrock examples in this repo)

## Environment variables (Bedrock)

Set these so the server can call Bedrock. Copy [.env.example](.env.example) to `.env` and fill in.

| Variable | Required | Description |
|----------|----------|-------------|
| `AWS_ACCESS_KEY_ID` | Yes | AWS access key |
| `AWS_SECRET_ACCESS_KEY` | Yes | AWS secret key |
| `AWS_REGION` | No | Region for Bedrock (default `us-west-2`) |

Optional: use `AWS_SESSION_TOKEN` if using temporary credentials.

**OpenTelemetry:** Set `OTEL_ENABLED=1` (or `true`) to enable tracing. Spans are exported to the server terminal (stdout) via the OpenTelemetry console exporter.

**Run history persistence (SQLite):** By default, all runs/events/metrics/telemetry are stored in:

- `./.data/browser-multi-agent-stream.sqlite`

Override with:

- `RUN_HISTORY_DB_PATH=/absolute/path/to/runs.sqlite`

## Install and run

From this directory:

```bash
npm install
npm run dev
```

Then open **http://localhost:5173**.

## Playground features

- **Guided presets** — Scenario templates mapped to SDK feature areas (Single, Swarm, Graph, Structured Output, Session/Persistence, Agents-as-Tools, Telemetry, Interrupts, Steering, Dynamic Orchestrator Factory, Orchestrator Contract, Agent Review/LLM Judge), with editable agents/prompts/tools and step-by-step guidance.
- **Agent builder** — Add up to 5 agents (2–5). Each card has a name and system prompt (max 500 chars). Remove agents with the card’s Remove button.
- **Per-agent tool constraints** — Set tool access as a comma-separated list per agent (empty list means no tools).
- **Mode** — **Single**: one selected agent runs. **Swarm**: self-organizing handoffs; choose entry point and max handoffs (1–5). **Graph**: deterministic DAG; add edges (from → to) and choose which nodes are entry points.
- **Run** — Sends the current config + prompt to the server. The server builds agents and Swarm or Graph on the fly and streams events back.
- **Stream** — Live streamed output with inline node labels (`--- [nodeName] ---`) when the active node changes.
- **Execution timeline** — Per-node lanes with status badges (executing, completed, failed) and handoff entries.
- **Metrics** — Per-node table (input/output tokens, execution time, status) plus totals and execution order (Swarm node history or Graph execution order).
- **History dashboard** — Persistent run history with status, prompts, outputs, event logs, per-node metrics, telemetry spans, token usage, and cost trends over time.
- **Result** — Final status, usage, and answer text.

## API (server)

`POST /api/run` accepts a JSON body:

- `prompt` (string) — User question or task.
- `mode` — `"single"`, `"swarm"`, or `"graph"`.
- `agents` — Array of `{ name, systemPrompt, tools? }` (1–5 agents).
- `sessionId` (optional) — Stable ID for SDK session persistence between runs.
- **Single:** `singleAgent` (agent name).
- **Swarm:** `entryPoint` (agent name), `maxHandoffs` (1–5).
- **Graph:** `edges` — `[{ from, to }]` (max 10), `entryPoints` — array of agent names that are entry nodes.

Server enforces: max 5 agents, 500 chars per system prompt, max 5 handoffs (Swarm), max 10 iterations/node executions, 120s execution timeout, 60s node timeout. Response is SSE: stream events plus a final `done` event with `status`, `text`, `usage`, `executionTime`, `nodeHistory` or `executionOrder`, and `perNode` metrics.

Additional read APIs:

- `GET /api/history?limit=50&offset=0` — paginated run summaries.
- `GET /api/history/stats?days=30` — aggregate totals and daily cost/token trends.
- `GET /api/history/:runId` — full run detail (agents, edges, events, node metrics, telemetry spans).

## Scripts

- `npm run dev` — Vite dev server (port 5173) + API server (port 3000); Vite proxies `/api` to the API.
- `npm run build` — Build client (Vite) and server (tsc).
- `npm run start` — Run API server only; serves built client from `dist` and handles `/api/run`. Set `NODE_ENV=production` when running after build.

## Architecture

- **Frontend**: Two-column layout (sidebar config, content area). Builds a config payload from UI state and sends it with the prompt to `POST /api/run`; consumes SSE for stream, timeline, events, and final result/metrics.
- **Server**: Express; validates and clamps the payload, creates a shared BedrockModel and dynamic Agent instances, builds either a Swarm or a Graph from the config, runs `stream(prompt)`, and streams each event as SSE. Sends an enriched `done` event with per-node metrics. Credentials stay server-side.
