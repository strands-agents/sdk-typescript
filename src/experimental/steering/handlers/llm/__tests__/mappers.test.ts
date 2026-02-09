import { describe, expect, it } from 'vitest'
import { DefaultPromptMapper } from '../mappers.js'
import { SteeringContext } from '../../../core/context.js'

describe('DefaultPromptMapper', () => {
  const mapper = new DefaultPromptMapper()

  describe('createSteeringPrompt', () => {
    it('generates prompt for tool call with context', () => {
      const context = new SteeringContext()
      context.set('ledger', {
        session_start: '2026-01-01T00:00:00.000Z',
        tool_calls: [{ tool_name: 'test', status: 'pending' }],
      })

      const prompt = mapper.createSteeringPrompt(context, {
        name: 'delete_file',
        input: { path: '/tmp/test.txt' },
      })

      expect(prompt).toContain('# Steering Evaluation')
      expect(prompt).toContain('tool call')
      expect(prompt).toContain('Tool Call')
      expect(prompt).toContain('Tool: delete_file')
      expect(prompt).toContain('/tmp/test.txt')
      expect(prompt).toContain('test')
      expect(prompt).toContain('pending')
    })

    it('generates prompt without tool use', () => {
      const context = new SteeringContext()

      const prompt = mapper.createSteeringPrompt(context)

      expect(prompt).toContain('# Steering Evaluation')
      expect(prompt).toContain('action')
      expect(prompt).toContain('Action')
      expect(prompt).toContain('General evaluation')
      expect(prompt).toContain('No context available')
    })

    it('includes empty context message when no data', () => {
      const context = new SteeringContext()

      const prompt = mapper.createSteeringPrompt(context, { name: 'test', input: {} })

      expect(prompt).toContain('No context available')
    })

    it('formats context data as JSON', () => {
      const context = new SteeringContext()
      context.set('key1', 'value1')
      context.set('key2', 42)

      const prompt = mapper.createSteeringPrompt(context, { name: 'test', input: {} })

      expect(prompt).toContain('"key1": "value1"')
      expect(prompt).toContain('"key2": 42')
    })

    it('includes ledger state explanation', () => {
      const context = new SteeringContext()

      const prompt = mapper.createSteeringPrompt(context, { name: 'test', input: {} })

      expect(prompt).toContain('Understanding Ledger Tool States')
      expect(prompt).toContain('"pending"')
      expect(prompt).toContain('"success"')
      expect(prompt).toContain('"error"')
    })

    it('contains Agent SOP structure sections', () => {
      const context = new SteeringContext()
      context.set('test', 'data')

      const prompt = mapper.createSteeringPrompt(context)

      expect(prompt).toContain('## Overview')
      expect(prompt).toContain('## Context')
      expect(prompt).toContain('## Event to Evaluate')
      expect(prompt).toContain('## Steps')
      expect(prompt).toContain('### 1. Analyze the Action')
      expect(prompt).toContain('### 2. Make Steering Decision')
      expect(prompt).toContain('**Constraints:**')
      expect(prompt).toContain('You MUST')
      expect(prompt).toContain('You SHOULD')
      expect(prompt).toContain('You MAY')
    })

    it('handles nested tool input fields', () => {
      const context = new SteeringContext()
      const prompt = mapper.createSteeringPrompt(context, {
        name: 'calculator',
        input: { operation: 'add', a: 1, b: 2 },
      })

      expect(prompt).toContain('Tool: calculator')
      expect(prompt).toContain('"operation": "add"')
      expect(prompt).toContain('"a": 1')
      expect(prompt).toContain('"b": 2')
    })

    it('formats nested context as indented JSON', () => {
      const context = new SteeringContext()
      context.set('nested', { key: 'value' })
      context.set('list', [1, 2, 3])

      const prompt = mapper.createSteeringPrompt(context)

      expect(prompt).toContain('{\n  "nested": {\n    "key": "value"\n  }')
      expect(prompt).toContain('"list": [\n    1,\n    2,\n    3\n  ]')
    })
  })
})
