import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SandboxStorage } from '../storage.js'
import { TestSandbox } from '../../../__fixtures__/test-sandbox.node.js'
import { execSync } from 'child_process'

const TEST_DIR = '/tmp/strands-test-sandbox-storage'

describe.skipIf(process.platform === 'win32')('SandboxStorage', () => {
  let sandbox: TestSandbox
  let storage: SandboxStorage

  beforeEach(() => {
    execSync(`rm -rf ${TEST_DIR} && mkdir -p ${TEST_DIR}`)
    sandbox = new TestSandbox(TEST_DIR)
    storage = new SandboxStorage(sandbox)
  })

  afterEach(() => {
    execSync(`rm -rf ${TEST_DIR}`)
  })

  it('stores and retrieves text content', async () => {
    const content = new TextEncoder().encode('hello offloaded')
    const reference = await storage.store('test-key', content, 'text/plain')
    const retrieved = await storage.retrieve(reference)
    expect(new TextDecoder().decode(retrieved.content)).toBe('hello offloaded')
    expect(retrieved.contentType).toBe('text/plain')
  })

  it('stores and retrieves JSON content', async () => {
    const json = JSON.stringify({ key: 'value' })
    const content = new TextEncoder().encode(json)
    const reference = await storage.store('json-key', content, 'application/json')
    const retrieved = await storage.retrieve(reference)
    expect(new TextDecoder().decode(retrieved.content)).toBe(json)
    expect(retrieved.contentType).toBe('application/json')
  })

  it('stores and retrieves binary content', async () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 254, 255])
    const reference = await storage.store('binary-key', bytes, 'application/octet-stream')
    const retrieved = await storage.retrieve(reference)
    expect(Array.from(retrieved.content)).toStrictEqual(Array.from(bytes))
  })

  it('creates files in the basePath directory', async () => {
    const content = new TextEncoder().encode('test')
    await storage.store('my-key', content, 'text/plain')
    const files = execSync(`ls ${TEST_DIR}/artifacts/`, { encoding: 'utf-8' })
    expect(files).toContain('my-key')
    expect(files).toContain('.txt')
  })

  it('uses custom basePath', async () => {
    const customStorage = new SandboxStorage(sandbox, 'artifacts')
    const content = new TextEncoder().encode('custom path')
    await customStorage.store('key', content, 'text/plain')
    const files = execSync(`ls ${TEST_DIR}/artifacts/`, { encoding: 'utf-8' })
    expect(files).toContain('.txt')
  })

  it('throws on retrieve with invalid reference', async () => {
    await expect(storage.retrieve('nonexistent/path.txt')).rejects.toThrow('Reference not found')
  })

  it('handles multiple stores with unique references', async () => {
    const c1 = new TextEncoder().encode('first')
    const c2 = new TextEncoder().encode('second')
    const ref1 = await storage.store('key', c1, 'text/plain')
    const ref2 = await storage.store('key', c2, 'text/plain')
    expect(ref1).not.toBe(ref2)
    expect(new TextDecoder().decode((await storage.retrieve(ref1)).content)).toBe('first')
    expect(new TextDecoder().decode((await storage.retrieve(ref2)).content)).toBe('second')
  })
})
