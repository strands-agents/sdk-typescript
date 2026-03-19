# SDK TypeScript Bug Bash

## How It Works

Each feature area has its own guide with what to test, what to look for, starter templates, and links to the docs.

Your goal: follow the docs, run the templates, poke at edge cases, and log anything that feels off.

## Sign Up

Claim a feature area by putting your name in the Assignee column. If you finish early, grab an unclaimed one or go deeper on your own.

| Feature Area | Guide | Assignee |
|-------------|-------|----------|
| Agent - Loop | [Guide](guides/agent-loop.md) | |
| Agent - Structured Output | [Guide](guides/agent-structured-output.md) | |
| Models - Bedrock | [Guide](guides/models-bedrock.md) | |
| Models - Anthropic | [Guide](guides/models-anthropic.md) | |
| Models - OpenAI | [Guide](guides/models-openai.md) | |
| Models - Google | [Guide](guides/models-google.md) | |
| Tools | [Guide](guides/tools.md) | |
| Tools - MCP | [Guide](guides/tools-mcp.md) | |
| Plugins | [Guide](guides/plugins.md) | |
| Conversation Management | [Guide](guides/conversation-management.md) | |
| Agent - A2A | [Guide](guides/agent-a2a.md) | |
| Tools - Notebook | [Guide](guides/tools-notebook.md) | |
| Tools - Bash | [Guide](guides/tools-bash.md) | |
| Tools - File Editor | [Guide](guides/tools-file-editor.md) | |
| Tools - HTTP Request | [Guide](guides/tools-http-request.md) | |
| Multi-Agents - Graph | [Guide](guides/multi-agents-graph.md) | |
| Multi-Agents - Swarm | [Guide](guides/multi-agents-swarm.md) | |
| Session Management | [Guide](guides/sessions.md) | |
| Telemetry | [Guide](guides/telemetry.md) | |

## Setup

### Create a project

```bash
mkdir strands-bug-bash && cd strands-bug-bash
npm init -y
```

Add `"type": "module"` to your `package.json` (required for top-level `await` in the templates):

```json
{
  "type": "module"
}
```

### Install dependencies

```bash
npm install \
  @strands-agents/sdk \
  openai \
  @anthropic-ai/sdk \
  @google/genai \
  @modelcontextprotocol/sdk \
  @a2a-js/sdk \
  express \
  @opentelemetry/api \
  @opentelemetry/sdk-trace-node \
  @opentelemetry/sdk-trace-base \
  tsx
```

### Configure credentials

- Bedrock: AWS credentials (via AWS CLI profile, env vars, or IAM role)
- OpenAI: `OPENAI_API_KEY`
- Anthropic: `ANTHROPIC_API_KEY`
- Google: `GEMINI_API_KEY`

### Run a template

Each guide links to a starter template in [templates/](templates/). Copy one into your project and run it:

```bash
cp <path-to-template> my-test.ts
npx tsx my-test.ts
```

### Testing in the browser

The SDK targets both Node.js and browser. Some features are Node-only (`FileStorage`, `bash` tool), but most of the core SDK works in both environments.

Copy the [browser-test/](templates/browser-test/) template into your project, then:

```bash
npm install vite --save-dev
npx vite browser-test
```

Open `http://localhost:5173`. Edit `browser-test/main.ts` with your test code. Vite handles TypeScript and hot reload automatically.

`process.env` is not available in the browser. To pass credentials, create a `browser-test/.env` file (Vite loads `.env` from its root directory):

```
VITE_AWS_ACCESS_KEY_ID=your-key
VITE_AWS_SECRET_ACCESS_KEY=your-secret
VITE_AWS_SESSION_TOKEN=your-token
VITE_AWS_REGION=us-east-1
VITE_OPENAI_API_KEY=your-key
VITE_ANTHROPIC_API_KEY=your-key
VITE_GOOGLE_API_KEY=your-key
```

Then access them in code via `import.meta.env.VITE_*`. Each provider takes credentials differently:

```typescript
// Bedrock: credentials go under clientConfig
const bedrock = new BedrockModel({
  region: import.meta.env.VITE_AWS_REGION,
  clientConfig: {
    credentials: {
      accessKeyId: import.meta.env.VITE_AWS_ACCESS_KEY_ID,
      secretAccessKey: import.meta.env.VITE_AWS_SECRET_ACCESS_KEY,
      sessionToken: import.meta.env.VITE_AWS_SESSION_TOKEN,
    },
  },
})

// Anthropic, OpenAI, Google: top-level apiKey
const anthropic = new AnthropicModel({ apiKey: import.meta.env.VITE_ANTHROPIC_API_KEY })
const openai = new OpenAIModel({ apiKey: import.meta.env.VITE_OPENAI_API_KEY })
const google = new GeminiModel({ apiKey: import.meta.env.VITE_GOOGLE_API_KEY })
```

Restart Vite after changing `.env` files.

