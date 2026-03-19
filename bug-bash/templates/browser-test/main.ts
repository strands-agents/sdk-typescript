import { Agent, BedrockModel } from '@strands-agents/sdk'

const output = document.getElementById('output')!

function log(message: string): void {
  output.textContent += '\n' + message
  console.log(message)
}

try {
  // Replace with your test code
  log('SDK imported successfully')
  log('Agent type: ' + typeof Agent)
  log('BedrockModel type: ' + typeof BedrockModel)

  // Example: test that types and classes are available
  // const agent = new Agent({ model: yourModel })
  // const result = await agent.invoke('Hello')
  // log('Result: ' + JSON.stringify(result))
} catch (error) {
  log('Error: ' + String(error))
}
