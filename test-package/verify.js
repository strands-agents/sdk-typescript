/**
 * Verification script to ensure the built package can be imported without a bundler.
 * This script runs in a pure Node.js ES module environment.
 */

import { BedrockModel, ToolRegistry, FunctionTool } from '@strands-agents/sdk'

console.log('✓ Import from main entry point successful')

// Verify BedrockModel can be instantiated
const model = new BedrockModel({ region: 'us-west-2' })
console.log('✓ BedrockModel instantiation successful')

// Verify basic functionality
const config = model.getConfig()
if (!config) {
  throw new Error('BedrockModel config is invalid')
}
console.log('✓ BedrockModel configuration retrieval successful')

// Verify ToolRegistry can be instantiated
const registry = new ToolRegistry()
console.log('✓ ToolRegistry instantiation successful')

// Verify FunctionTool can be created
const testTool = new FunctionTool({
  name: 'testTool',
  description: 'A test tool',
  inputSchema: {
    type: 'object',
    properties: {
      value: { type: 'string' },
    },
    required: ['value'],
  },
  callback: (input) => {
    return { result: input.value }
  },
})
console.log('✓ FunctionTool creation successful')

// Verify tool can be added to registry
registry.register(testTool)
console.log('✓ Tool registration successful')

// Verify tool can be retrieved
const retrievedTool = registry.get('testTool')
if (!retrievedTool) {
  throw new Error('Tool not found in registry')
}
console.log('✓ Tool retrieval successful')

console.log('\n✅ All verification checks passed!')
console.log('The package works correctly without a bundler.')
