import { Agent, BedrockModel } from '@strands-agents/sdk'
import { z } from 'zod'

// Define schemas for structured output
const PersonSchema = z.object({
  name: z.string().describe('Full name of the person'),
  age: z.number().describe('Age of the person in years'),
  occupation: z.string().describe('Current occupation or job title'),
})

const CompanySchema = z.object({
  name: z.string().describe('Company name'),
  industry: z.string().describe('Industry or sector'),
  employees: z.number().describe('Number of employees'),
  founded: z.number().describe('Year the company was founded'),
})

const LocationSchema = z.object({
  city: z.string().describe('City name'),
  state: z.string().describe('State or province'),
  country: z.string().describe('Country name'),
  population: z.number().optional().describe('Population if known'),
})

/**
 * Demonstrates basic structured output usage.
 */
async function basicExample() {
  console.log('=== Basic Structured Output Example ===\n')

  const agent = new Agent({ model: new BedrockModel() })

  const result = await agent.invoke('John Smith is a 30 year-old software engineer', {
    structuredOutputSchema: PersonSchema,
  })

  console.log('Structured Output:', result.structuredOutput)
  console.log(`Name: ${result.structuredOutput?.name}`)
  console.log(`Age: ${result.structuredOutput?.age}`)
  console.log(`Occupation: ${result.structuredOutput?.occupation}`)
  console.log()
}

/**
 * Demonstrates agent-level default schema.
 */
async function agentLevelDefaultExample() {
  console.log('=== Agent-Level Default Schema ===\n')

  const agent = new Agent({
    model: new BedrockModel(),
    structuredOutputSchema: PersonSchema,
  })

  // First invocation - uses default schema
  const result1 = await agent.invoke('Extract info: Sarah Johnson, 28, data scientist')
  console.log('First person:', result1.structuredOutput)

  // Second invocation - also uses default schema
  const result2 = await agent.invoke('Extract info: Michael Chen, 45, architect')
  console.log('Second person:', result2.structuredOutput)
  console.log()
}

/**
 * Demonstrates schema override at invocation level.
 */
async function schemaOverrideExample() {
  console.log('=== Schema Override Example ===\n')

  // Agent with default PersonSchema
  const agent = new Agent({
    model: new BedrockModel(),
    structuredOutputSchema: PersonSchema,
  })

  // Override with CompanySchema for this specific invocation
  const result = await agent.invoke('TechCorp is a software company founded in 2010 with 500 employees', {
    structuredOutputSchema: CompanySchema,
  })

  console.log('Company Info:', result.structuredOutput)
  console.log(`Name: ${result.structuredOutput?.name}`)
  console.log(`Industry: ${result.structuredOutput?.industry}`)
  console.log(`Employees: ${result.structuredOutput?.employees}`)
  console.log(`Founded: ${result.structuredOutput?.founded}`)
  console.log()
}

/**
 * Demonstrates streaming with structured output.
 */
async function streamingExample() {
  console.log('=== Streaming with Structured Output ===\n')

  const agent = new Agent({
    model: new BedrockModel(),
    printer: false, // Disable automatic printing to show events
  })

  console.log('Streaming events:')
  for await (const event of agent.stream('Seattle is in Washington state, USA, with about 750,000 people', {
    structuredOutputSchema: LocationSchema,
  })) {
    console.log(`  [${event.type}]`)
    
    if (event.type === 'agentResult') {
      console.log('\nFinal structured output:', event.structuredOutput)
    }
  }
  console.log()
}

/**
 * Demonstrates optional fields in schemas.
 */
async function optionalFieldsExample() {
  console.log('=== Optional Fields Example ===\n')

  const agent = new Agent({
    model: new BedrockModel(),
    structuredOutputSchema: LocationSchema,
  })

  // Location without population info
  const result = await agent.invoke('Portland is in Oregon, USA')
  console.log('Location (no population):', result.structuredOutput)
  console.log()
}

/**
 * Main entry point - runs all examples.
 */
async function main() {
  console.log('Strands Agents - Structured Output Examples\n')
  console.log('This example demonstrates type-safe, validated LLM responses using Zod schemas.\n')

  try {
    await basicExample()
    await agentLevelDefaultExample()
    await schemaOverrideExample()
    await streamingExample()
    await optionalFieldsExample()

    console.log('All examples completed successfully!')
  } catch (error) {
    console.error('Error running examples:', error)
    process.exit(1)
  }
}

await main()
