import { Agent, McpClient } from '@strands-agents/sdk'
import { OpenAIModel } from '../../../dist/src/models/openai.js'

async function runInvoke(title: string, agent: Agent, prompt: string) {
  console.log(`--- ${title} ---\nUser: ${prompt}`)
  const result = await agent.invoke(prompt)
  console.log(`\n\n::Invocation complete; stop reason was ${result.stopReason}\n`)
}

async function main() {
  const model = new OpenAIModel()

  const applicationConfig = {
    applicationName: 'First Agent Example',
    applicationVersion: '0.0.0',
  }

  const chromeDevtools = new McpClient({
    ...applicationConfig,
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'chrome-devtools-mcp'],
  })

  const agentWithMcpClient = new Agent({
    systemPrompt:
      'You are a helpful assistant that uses the chrome_devtools_mcp server as a demonstration of mcp functionality. You must only use tools without side effects.',
    tools: [chromeDevtools],
    model,
  })

  await runInvoke('1: Invocation with MCP client', agentWithMcpClient, 'Use a random tool from the MCP server.')

  if (!process.env.GITHUB_PAT) {
    console.warn('Skipping GitHub MCP client example; GITHUB_PAT environment variable not set.')
    return
  }

  // Create a remote MCP client
  const githubMcpClient = new McpClient({
    ...applicationConfig,
    type: 'http',
    url: 'https://api.githubcopilot.com/mcp/',
    requestInit: {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_PAT}`,
      },
    },
  })

  const agentWithGithubMcpClient = new Agent({
    systemPrompt:
      'You are a helpful assistant that uses the github_mcp server as a demonstration of mcp functionality. You must only use tools without side effects.',
    tools: [githubMcpClient],
    model,
  })

  await runInvoke(
    '2: Invocation with GitHub MCP client',
    agentWithGithubMcpClient,
    'Use a random tool from the GitHub MCP server to illustrate that they work.'
  )
}

main().catch(console.error)
