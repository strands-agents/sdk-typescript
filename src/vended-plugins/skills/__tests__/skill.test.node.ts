import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Skill } from '../skill.js'
import { promises as fs } from 'fs'
import * as path from 'path'
import { tmpdir } from 'os'

describe('Skill', () => {
  let testDir: string

  const createSkillDir = async (name: string, content: string, filename = 'SKILL.md'): Promise<string> => {
    const dirPath = path.join(testDir, name)
    await fs.mkdir(dirPath, { recursive: true })
    await fs.writeFile(path.join(dirPath, filename), content, 'utf-8')
    return dirPath
  }

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `skill-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await fs.mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true })
  })

  describe('constructor', () => {
    it('should create a skill with required fields', () => {
      const skill = new Skill({ name: 'test-skill', description: 'A test skill' })
      expect(skill.name).toBe('test-skill')
      expect(skill.description).toBe('A test skill')
      expect(skill.instructions).toBe('')
      expect(skill.path).toBeUndefined()
      expect(skill.allowedTools).toBeUndefined()
      expect(skill.metadata).toEqual({})
      expect(skill.license).toBeUndefined()
      expect(skill.compatibility).toBeUndefined()
    })

    it('should create a skill with all fields', () => {
      const skill = new Skill({
        name: 'full-skill',
        description: 'Full description',
        instructions: '# Instructions\nDo things',
        path: '/some/path',
        allowedTools: ['bash', 'file-editor'],
        metadata: { author: 'test' },
        license: 'Apache-2.0',
        compatibility: 'v1.0+',
      })
      expect(skill.name).toBe('full-skill')
      expect(skill.instructions).toBe('# Instructions\nDo things')
      expect(skill.path).toBe('/some/path')
      expect(skill.allowedTools).toEqual(['bash', 'file-editor'])
      expect(skill.metadata).toEqual({ author: 'test' })
      expect(skill.license).toBe('Apache-2.0')
      expect(skill.compatibility).toBe('v1.0+')
    })
  })

  describe('fromContent', () => {
    it('should parse valid SKILL.md content', () => {
      const content = `---
name: my-skill
description: Does something useful
---
# Instructions
Follow these steps.`

      const skill = Skill.fromContent(content)
      expect(skill.name).toBe('my-skill')
      expect(skill.description).toBe('Does something useful')
      expect(skill.instructions).toBe('# Instructions\nFollow these steps.')
    })

    it('should parse content with allowed-tools as space-delimited string', () => {
      const content = `---
name: my-skill
description: A skill
allowed-tools: bash file-editor
---
Instructions here.`

      const skill = Skill.fromContent(content)
      expect(skill.allowedTools).toEqual(['bash', 'file-editor'])
    })

    it('should parse content with allowed-tools as YAML list', () => {
      const content = `---
name: my-skill
description: A skill
allowed-tools:
  - bash
  - file-editor
---
Instructions here.`

      const skill = Skill.fromContent(content)
      expect(skill.allowedTools).toEqual(['bash', 'file-editor'])
    })

    it('should parse content with allowed_tools underscore variant', () => {
      const content = `---
name: my-skill
description: A skill
allowed_tools: bash notebook
---
Instructions here.`

      const skill = Skill.fromContent(content)
      expect(skill.allowedTools).toEqual(['bash', 'notebook'])
    })

    it('should parse content with metadata', () => {
      const content = `---
name: my-skill
description: A skill
metadata:
  author: test-user
  version: 1
---
Body.`

      const skill = Skill.fromContent(content)
      expect(skill.metadata).toEqual({ author: 'test-user', version: 1 })
    })

    it('should parse content with license and compatibility', () => {
      const content = `---
name: my-skill
description: A skill
license: MIT
compatibility: strands-agents >= 1.0
---
Body.`

      const skill = Skill.fromContent(content)
      expect(skill.license).toBe('MIT')
      expect(skill.compatibility).toBe('strands-agents >= 1.0')
    })

    it('should throw if content does not start with ---', () => {
      expect(() => Skill.fromContent('no frontmatter')).toThrow('SKILL.md must start with --- frontmatter delimiter')
    })

    it('should throw if closing --- is missing', () => {
      expect(() => Skill.fromContent('---\nname: test\n')).toThrow('SKILL.md frontmatter missing closing --- delimiter')
    })

    it('should throw if name is missing', () => {
      const content = `---
description: no name
---
Body.`
      expect(() => Skill.fromContent(content)).toThrow("must have a 'name' field")
    })

    it('should throw if description is missing', () => {
      const content = `---
name: my-skill
---
Body.`
      expect(() => Skill.fromContent(content)).toThrow("must have a 'description' field")
    })

    it('should handle empty body', () => {
      const content = `---
name: my-skill
description: A skill
---`

      const skill = Skill.fromContent(content)
      expect(skill.instructions).toBe('')
    })

    it('should warn but not throw for invalid name in lenient mode', () => {
      const content = `---
name: INVALID_NAME
description: A skill
---
Body.`

      // Should not throw in lenient mode (default)
      const skill = Skill.fromContent(content)
      expect(skill.name).toBe('INVALID_NAME')
    })

    it('should throw for invalid name in strict mode', () => {
      const content = `---
name: INVALID_NAME
description: A skill
---
Body.`

      expect(() => Skill.fromContent(content, { strict: true })).toThrow('skill name should be')
    })

    it('should throw for empty name in strict mode', () => {
      const content = `---
name: ""
description: A skill
---
Body.`

      expect(() => Skill.fromContent(content)).toThrow("must have a 'name' field")
    })

    it('should throw for name exceeding length limit in strict mode', () => {
      const longName = 'a'.repeat(65)
      const content = `---
name: ${longName}
description: A skill
---
Body.`

      expect(() => Skill.fromContent(content, { strict: true })).toThrow('exceeds 64 character limit')
    })

    it('should throw for consecutive hyphens in strict mode', () => {
      const content = `---
name: my--skill
description: A skill
---
Body.`

      expect(() => Skill.fromContent(content, { strict: true })).toThrow('consecutive hyphens')
    })

    it('should handle body containing --- horizontal rules', () => {
      const content = `---
name: my-skill
description: A skill
---
# Instructions

First section.

---

Second section after horizontal rule.

---

Third section.`

      const skill = Skill.fromContent(content)
      expect(skill.name).toBe('my-skill')
      expect(skill.instructions).toContain('First section.')
      expect(skill.instructions).toContain('---')
      expect(skill.instructions).toContain('Third section.')
    })

    it('should handle body with only whitespace after frontmatter', () => {
      const content = `---
name: my-skill
description: A skill
---

   `

      const skill = Skill.fromContent(content)
      expect(skill.name).toBe('my-skill')
      expect(skill.instructions).toBe('')
    })

    it('should handle frontmatter value containing --- inline', () => {
      const content = `---
name: my-skill
description: Use this --- for special cases
---
Body.`

      const skill = Skill.fromContent(content)
      expect(skill.name).toBe('my-skill')
      expect(skill.description).toBe('Use this --- for special cases')
    })

    it('should ignore non-object metadata', () => {
      const content = `---
name: my-skill
description: A skill
metadata: just-a-string
---
Body.`

      const skill = Skill.fromContent(content)
      expect(skill.metadata).toEqual({})
    })

    it('should ignore array metadata', () => {
      const content = `---
name: my-skill
description: A skill
metadata:
  - item1
  - item2
---
Body.`

      const skill = Skill.fromContent(content)
      expect(skill.metadata).toEqual({})
    })

    it('should handle allowed-tools as empty string', () => {
      const content = `---
name: my-skill
description: A skill
allowed-tools: ""
---
Body.`

      const skill = Skill.fromContent(content)
      expect(skill.allowedTools).toBeUndefined()
    })

    it('should filter null entries from allowed-tools array', () => {
      const content = `---
name: my-skill
description: A skill
allowed-tools:
  - bash
  - null
  - file-editor
---
Body.`

      const skill = Skill.fromContent(content)
      expect(skill.allowedTools).toEqual(['bash', 'file-editor'])
    })
  })

  describe('fromFile', () => {
    it('should load a skill from a directory', async () => {
      const dirPath = await createSkillDir(
        'my-skill',
        `---
name: my-skill
description: A test skill
---
# Instructions
Do the thing.`
      )

      const skill = Skill.fromFile(dirPath)
      expect(skill.name).toBe('my-skill')
      expect(skill.description).toBe('A test skill')
      expect(skill.instructions).toBe('# Instructions\nDo the thing.')
      expect(skill.path).toBe(dirPath)
    })

    it('should load a skill from a SKILL.md file path', async () => {
      const dirPath = await createSkillDir(
        'my-skill',
        `---
name: my-skill
description: A test skill
---
Body.`
      )
      const filePath = path.join(dirPath, 'SKILL.md')

      const skill = Skill.fromFile(filePath)
      expect(skill.name).toBe('my-skill')
      expect(skill.path).toBe(dirPath)
    })

    it('should find lowercase skill.md as fallback', async () => {
      const dirPath = await createSkillDir(
        'my-skill',
        `---
name: my-skill
description: A test skill
---
Body.`,
        'skill.md'
      )

      const skill = Skill.fromFile(dirPath)
      expect(skill.name).toBe('my-skill')
    })

    it('should throw for non-existent path', () => {
      expect(() => Skill.fromFile('/does/not/exist')).toThrow('does not exist')
    })

    it('should warn when skill name does not match directory name', async () => {
      const dirPath = await createSkillDir(
        'wrong-dir-name',
        `---
name: actual-skill-name
description: Mismatched name
---
Body.`
      )

      // Should not throw in lenient mode
      const skill = Skill.fromFile(dirPath)
      expect(skill.name).toBe('actual-skill-name')
    })

    it('should throw when skill name does not match directory in strict mode', async () => {
      const dirPath = await createSkillDir(
        'wrong-dir-name',
        `---
name: actual-skill-name
description: Mismatched name
---
Body.`
      )

      expect(() => Skill.fromFile(dirPath, { strict: true })).toThrow('does not match parent directory name')
    })
  })

  describe('fromDirectory', () => {
    it('should load all skills from a directory', async () => {
      await createSkillDir(
        'skill-a',
        `---
name: skill-a
description: First skill
---
Instructions A.`
      )
      await createSkillDir(
        'skill-b',
        `---
name: skill-b
description: Second skill
---
Instructions B.`
      )

      const skills = Skill.fromDirectory(testDir)
      expect(skills).toHaveLength(2)
      expect(skills.map((s) => s.name).sort()).toEqual(['skill-a', 'skill-b'])
    })

    it('should skip directories without SKILL.md', async () => {
      await createSkillDir(
        'valid-skill',
        `---
name: valid-skill
description: Has SKILL.md
---
Body.`
      )
      // Create a directory without SKILL.md
      await fs.mkdir(path.join(testDir, 'no-skill-md'), { recursive: true })
      await fs.writeFile(path.join(testDir, 'no-skill-md', 'README.md'), 'not a skill', 'utf-8')

      const skills = Skill.fromDirectory(testDir)
      expect(skills).toHaveLength(1)
      expect(skills[0]!.name).toBe('valid-skill')
    })

    it('should skip non-directory children', async () => {
      await createSkillDir(
        'valid-skill',
        `---
name: valid-skill
description: Has SKILL.md
---
Body.`
      )
      // Create a plain file in the parent directory
      await fs.writeFile(path.join(testDir, 'some-file.txt'), 'not a directory', 'utf-8')

      const skills = Skill.fromDirectory(testDir)
      expect(skills).toHaveLength(1)
    })

    it('should skip skills with invalid content', async () => {
      await createSkillDir(
        'valid-skill',
        `---
name: valid-skill
description: Good skill
---
Body.`
      )
      await createSkillDir(
        'bad-skill',
        `---
description: Missing name
---
Body.`
      )

      const skills = Skill.fromDirectory(testDir)
      expect(skills).toHaveLength(1)
      expect(skills[0]!.name).toBe('valid-skill')
    })

    it('should throw for non-existent directory', () => {
      expect(() => Skill.fromDirectory('/does/not/exist')).toThrow('skills directory does not exist')
    })

    it('should return empty array for directory with no skills', async () => {
      const skills = Skill.fromDirectory(testDir)
      expect(skills).toEqual([])
    })

    it('should skip skills with completely broken SKILL.md (no frontmatter)', async () => {
      await createSkillDir(
        'valid-skill',
        `---
name: valid-skill
description: Good skill
---
Body.`
      )
      await createSkillDir('broken-skill', 'totally broken, no frontmatter at all')

      const skills = Skill.fromDirectory(testDir)
      expect(skills).toHaveLength(1)
      expect(skills[0]!.name).toBe('valid-skill')
    })
  })
})
