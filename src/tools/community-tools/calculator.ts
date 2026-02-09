import { FunctionTool } from '../function-tool.js'
import type { JSONValue } from '../../types/json.js'
import { all, create, type MathJsStatic, type MathNode } from 'mathjs'

const math = create(all!) as MathJsStatic

interface CalculatorInput {
  expression?: string
  mode?: string
  precision?: number
  variables?: Record<string, string | number>
  wrt?: string
  order?: number
}

function successResult(text: string): JSONValue {
  return { status: 'success', content: [{ text }] }
}

function errorResult(text: string): JSONValue {
  return { status: 'error', content: [{ text }] }
}

function evaluateExpression(input: CalculatorInput): JSONValue {
  try {
    const expr = input.expression ?? ''
    const scope = input.variables ?? {}
    const result: unknown = math.evaluate(expr, scope)
    const text =
      typeof result === 'object' && result !== null && 'toString' in result
        ? (result as { toString(): string }).toString()
        : String(result)
    return successResult(`Result: ${text}`)
  } catch (e) {
    return errorResult(`Error: ${e instanceof Error ? e.message : String(e)}`)
  }
}

function simplifyExpression(input: CalculatorInput): JSONValue {
  try {
    const expr = input.expression ?? ''
    const node: MathNode = math.parse(expr)
    const simplified = math.simplify(node)
    return successResult(`Result: ${simplified.toString()}`)
  } catch (e) {
    return errorResult(`Error: ${e instanceof Error ? e.message : String(e)}`)
  }
}

function deriveExpression(input: CalculatorInput): JSONValue {
  try {
    const expr = input.expression ?? ''
    const variable = input.wrt ?? 'x'
    const order = input.order ?? 1
    let result: MathNode = math.derivative(math.parse(expr), variable)
    for (let i = 1; i < order; i++) {
      result = math.derivative(result, variable)
    }
    return successResult(`Result: ${result.toString()}`)
  } catch (e) {
    return errorResult(`Error: ${e instanceof Error ? e.message : String(e)}`)
  }
}

function runCalculator(input: CalculatorInput): JSONValue {
  const mode = input.mode ?? 'evaluate'
  switch (mode) {
    case 'simplify':
      return simplifyExpression(input)
    case 'derive':
      return deriveExpression(input)
    case 'evaluate':
    default:
      return evaluateExpression(input)
  }
}

export const calculator = new FunctionTool({
  name: 'calculator',
  description:
    'Perform mathematical operations: evaluate expressions, simplify, or derive. Modes: evaluate (default), simplify, derive.',
  inputSchema: {
    type: 'object',
    properties: {
      expression: { type: 'string', description: 'Mathematical expression (e.g. "2 + 3 * 4", "x^2 + 2*x + 1")' },
      mode: {
        type: 'string',
        enum: ['evaluate', 'simplify', 'derive'],
        description: 'Operation mode',
      },
      precision: { type: 'number', description: 'Decimal precision' },
      variables: { type: 'object', description: 'Variable substitutions' },
      wrt: { type: 'string', description: 'Variable for derive (e.g. x)' },
      order: { type: 'number', description: 'Order of derivative' },
    },
  },
  callback: (input: unknown): JSONValue => runCalculator((input ?? {}) as CalculatorInput),
})
