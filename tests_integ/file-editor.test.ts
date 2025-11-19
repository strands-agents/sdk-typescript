/* eslint-disable no-restricted-imports */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Agent, BedrockModel } from '../src/index.js'
import { fileEditor } from '../vended_tools/file_editor/index.js'
import { shouldRunTests, extractToolResults } from './__fixtures__/model-test-helpers.js'
import { shouldRunTests, extractToolResults } from './__fixtures__/model-test-helpers.js'
import { promises as fs } from 'fs'
import * as path from 'path'
import { tmpdir } from 'os'

describe.skipIf(!(await shouldRunTests()))('FileEditor Tool Integration', () => {
  let testDir: string

  // Shared agent configuration for all tests
  const createAgent = () =>
    new Agent({
      model: new BedrockModel({
        region: 'us-east-1',
      }),
      tools: [fileEditor],
    })

  beforeEach(async () => {
    // Create a temporary test directory
    testDir = path.join(tmpdir(), `file-editor-integ-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await fs.mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true })
    } catch (error) {
      console.error('Failed to clean up test directory', testDir)
      console.error(error)
    }
  })

  it('should create and view a file via prompt', async () => {
    const agent = createAgent()
    const testFile = path.join(testDir, 'test.txt')

    // Create a file
    await agent.invoke(`Create a file at ${testFile} with content "Hello World"`)

    // Verify file was created on disk
    const fileContent = await fs.readFile(testFile, 'utf-8')
    expect(fileContent).toBe('Hello World')

    // View the file
    const result = await agent.invoke(`View the file at ${testFile}`)

    // Verify that tools were called successfully
    expect(extractToolResults(agent).length).toBeGreaterThan(0)

    // Verify the agent received and understood the file content
    const responseText = result.lastMessage.content
      .filter((block) => block.type === 'textBlock')
      .map((block) => block.text)
      .join(' ')
    expect(responseText).toContain('Hello World')
  }, 60000)

  it('should edit a file using str_replace', async () => {
    const agent = createAgent()
    const testFile = path.join(testDir, 'edit-test.txt')

    // Create initial file
    await agent.invoke(`Create a file at ${testFile} with content "Hello OLD World"`)

    // Replace text
    await agent.invoke(`In the file ${testFile}, replace "OLD" with "NEW"`)

    // Verify the replacement on disk
    const fileContent = await fs.readFile(testFile, 'utf-8')
    expect(fileContent).toBe('Hello NEW World')
  }, 60000)

  it('should insert text at specific lines', async () => {
    const agent = createAgent()
    const testFile = path.join(testDir, 'insert-test.txt')

    // Create file with multiple lines
    const initialContent = 'Line 1\nLine 2\nLine 3'
    await agent.invoke(`Create a file at ${testFile} with content "${initialContent}"`)

    // Insert text at line 2
    await agent.invoke(`In the file ${testFile}, insert "Inserted Line" at line 2`)

    // Verify the insertion on disk
    const fileContent = await fs.readFile(testFile, 'utf-8')
    expect(fileContent).toBe('Line 1\nLine 2\nInserted Line\nLine 3')
  }, 60000)

  it('should maintain edit history and support undo', async () => {
    const agent = createAgent()
    const testFile = path.join(testDir, 'undo-test.txt')

    // Create initial file
    await agent.invoke(`Create a file at ${testFile} with content "Original"`)

    // Make an edit
    await agent.invoke(`In the file ${testFile}, replace "Original" with "Modified"`)

    // Verify edit was applied
    let fileContent = await fs.readFile(testFile, 'utf-8')
    expect(fileContent).toBe('Modified')

    // Verify history is maintained in state
    const history = agent.state.get('fileEditorHistory') as any
    expect(history).toBeTruthy()
    expect(history[testFile]).toBeDefined()
    expect(history[testFile].length).toBeGreaterThan(0)

    // Undo the edit
    await agent.invoke(`Undo the last edit to ${testFile}`)

    // Verify file was restored
    fileContent = await fs.readFile(testFile, 'utf-8')
    expect(fileContent).toBe('Original')
  }, 60000)

  it('should view directory contents', async () => {
    const agent = createAgent()

    // Create some files in the test directory
    await fs.writeFile(path.join(testDir, 'file1.txt'), 'content1', 'utf-8')
    await fs.writeFile(path.join(testDir, 'file2.txt'), 'content2', 'utf-8')
    await fs.mkdir(path.join(testDir, 'subdir'), { recursive: true })
    await fs.writeFile(path.join(testDir, 'subdir', 'file3.txt'), 'content3', 'utf-8')

    // View the directory
    const result = await agent.invoke(`List the files in directory ${testDir}`)

    // Verify that tools were called successfully
    expect(extractToolResults(agent).length).toBeGreaterThan(0)

    // Verify the agent received and processed the directory listing
    const responseText = result.lastMessage.content
      .filter((block) => block.type === 'textBlock')
      .map((block) => block.text)
      .join(' ')
    expect(responseText).toContain('file1.txt')
    expect(responseText).toContain('file2.txt')
  }, 60000)

  it('should handle multi-line file content', async () => {
    const agent = createAgent()
    const testFile = path.join(testDir, 'multiline-test.txt')

    // Create file with multiple lines
    const multilineContent = `Line 1
Line 2
Line 3
Line 4`

    await agent.invoke(`Create a file at ${testFile} with this content:
${multilineContent}`)

    // Verify file was created correctly
    const fileContent = await fs.readFile(testFile, 'utf-8')
    expect(fileContent).toContain('Line 1')
    expect(fileContent).toContain('Line 4')

    // Replace multi-line content
    await agent.invoke(`In the file ${testFile}, replace "Line 2
Line 3" with "Replaced Lines"`)

    // Verify replacement
    const updatedContent = await fs.readFile(testFile, 'utf-8')
    expect(updatedContent).toContain('Replaced Lines')
    expect(updatedContent).not.toContain('Line 2')
  }, 60000)

  it('should handle view with line ranges', async () => {
    const agent = createAgent()
    const testFile = path.join(testDir, 'range-test.txt')

    // Create file with multiple lines
    const content = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5'
    await agent.invoke(`Create a file at ${testFile} with content "${content}"`)

    // View specific line range
    const result = await agent.invoke(`View lines 2 to 4 of file ${testFile}`)

    // Verify that tools were called successfully
    expect(extractToolResults(agent).length).toBeGreaterThan(0)

    // Verify the agent received and understood the requested line range
    const responseText = result.lastMessage.content
      .filter((block) => block.type === 'textBlock')
      .map((block) => block.text)
      .join(' ')
    expect(responseText).toContain('Line 2')
    expect(responseText).toContain('Line 3')
    expect(responseText).toContain('Line 4')
  }, 60000)
})
