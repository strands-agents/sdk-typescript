import { describe, it, expect } from 'vitest'
import {
  batch,
  calculator,
  countdown,
  cron,
  currentTime,
  environment,
  fileRead,
  fileWrite,
  graph,
  handoffToUser,
  journal,
  parseJson,
  retrieve,
  sleep,
  stop,
  swarm,
  think,
} from '../index.js'

describe('community-tools index', () => {
  it('exports batch as FunctionTool', () => {
    expect(batch).toBeDefined()
    expect(batch.name).toBe('batch')
    expect(typeof batch.stream).toBe('function')
  })

  it('exports calculator as FunctionTool', () => {
    expect(calculator).toBeDefined()
    expect(calculator.name).toBe('calculator')
    expect(typeof calculator.stream).toBe('function')
  })

  it('exports countdown as FunctionTool', () => {
    expect(countdown).toBeDefined()
    expect(countdown.name).toBe('countdown')
    expect(typeof countdown.stream).toBe('function')
  })

  it('exports cron as FunctionTool', () => {
    expect(cron).toBeDefined()
    expect(cron.name).toBe('cron')
    expect(typeof cron.stream).toBe('function')
  })

  it('exports currentTime as FunctionTool', () => {
    expect(currentTime).toBeDefined()
    expect(currentTime.name).toBe('current_time')
    expect(typeof currentTime.stream).toBe('function')
  })

  it('exports environment as FunctionTool', () => {
    expect(environment).toBeDefined()
    expect(environment.name).toBe('environment')
    expect(typeof environment.stream).toBe('function')
  })

  it('exports fileRead as FunctionTool', () => {
    expect(fileRead).toBeDefined()
    expect(fileRead.name).toBe('file_read')
    expect(typeof fileRead.stream).toBe('function')
  })

  it('exports fileWrite as FunctionTool', () => {
    expect(fileWrite).toBeDefined()
    expect(fileWrite.name).toBe('file_write')
    expect(typeof fileWrite.stream).toBe('function')
  })

  it('exports graph as FunctionTool', () => {
    expect(graph).toBeDefined()
    expect(graph.name).toBe('graph')
    expect(typeof graph.stream).toBe('function')
  })

  it('exports handoffToUser as FunctionTool', () => {
    expect(handoffToUser).toBeDefined()
    expect(handoffToUser.name).toBe('handoff_to_user')
    expect(typeof handoffToUser.stream).toBe('function')
  })

  it('exports journal as FunctionTool', () => {
    expect(journal).toBeDefined()
    expect(journal.name).toBe('journal')
    expect(typeof journal.stream).toBe('function')
  })

  it('exports parseJson as FunctionTool', () => {
    expect(parseJson).toBeDefined()
    expect(parseJson.name).toBe('parse_json')
    expect(typeof parseJson.stream).toBe('function')
  })

  it('exports retrieve as FunctionTool', () => {
    expect(retrieve).toBeDefined()
    expect(retrieve.name).toBe('retrieve')
    expect(typeof retrieve.stream).toBe('function')
  })

  it('exports sleep as FunctionTool', () => {
    expect(sleep).toBeDefined()
    expect(sleep.name).toBe('sleep')
    expect(typeof sleep.stream).toBe('function')
  })

  it('exports stop as FunctionTool', () => {
    expect(stop).toBeDefined()
    expect(stop.name).toBe('stop')
    expect(typeof stop.stream).toBe('function')
  })

  it('exports swarm as FunctionTool', () => {
    expect(swarm).toBeDefined()
    expect(swarm.name).toBe('swarm')
    expect(typeof swarm.stream).toBe('function')
  })

  it('exports think as FunctionTool', () => {
    expect(think).toBeDefined()
    expect(think.name).toBe('think')
    expect(typeof think.stream).toBe('function')
  })
})
