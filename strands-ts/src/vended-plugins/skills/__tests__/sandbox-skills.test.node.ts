import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Skill } from '../skill.js'
import { AgentSkills } from '../agent-skills.js'
import { TestSandbox } from '../../../__fixtures__/test-sandbox.node.js'
import { createMockAgent } from '../../../__fixtures__/agent-helpers.js'
import { execSync } from 'child_process'

const TEST_DIR = '/tmp/strands-test-sandbox-skills'

const VALID_SKILL_MD = `---
name: test-skill
description: A test skill loaded from sandbox
---
# Instructions
Do the thing.
`

describe.skipIf(process.platform === 'win32')('Skill sandbox loading', () => {
  let sandbox: TestSandbox

  beforeEach(() => {
    execSync(`rm -rf ${TEST_DIR} && mkdir -p ${TEST_DIR}`)
    sandbox = new TestSandbox(TEST_DIR)
  })

  afterEach(() => {
    execSync(`rm -rf ${TEST_DIR}`)
  })

  describe('Skill.fromSandbox', () => {
    it('loads a skill from a directory with SKILL.md', async () => {
      execSync(`mkdir -p ${TEST_DIR}/my-skill && cat > ${TEST_DIR}/my-skill/SKILL.md << 'EOF'\n${VALID_SKILL_MD}\nEOF`)
      const skills = await Skill.fromSandbox(sandbox, 'my-skill')
      expect(skills).toHaveLength(1)
      expect(skills[0]!.name).toBe('test-skill')
      expect(skills[0]!.description).toBe('A test skill loaded from sandbox')
      expect(skills[0]!.instructions).toContain('Do the thing')
    })

    it('loads a skill from a direct SKILL.md path', async () => {
      execSync(`mkdir -p ${TEST_DIR}/direct && cat > ${TEST_DIR}/direct/SKILL.md << 'EOF'\n${VALID_SKILL_MD}\nEOF`)
      const skills = await Skill.fromSandbox(sandbox, 'direct/SKILL.md')
      expect(skills).toHaveLength(1)
      expect(skills[0]!.name).toBe('test-skill')
    })

    it('loads all skills from a parent directory', async () => {
      const skill2 = '---\nname: another-skill\ndescription: Another one\n---\nInstructions here.'
      execSync(
        `mkdir -p ${TEST_DIR}/skills/skill-a && cat > ${TEST_DIR}/skills/skill-a/SKILL.md << 'EOF'\n${VALID_SKILL_MD}\nEOF`
      )
      execSync(
        `mkdir -p ${TEST_DIR}/skills/skill-b && cat > ${TEST_DIR}/skills/skill-b/SKILL.md << 'EOF'\n${skill2}\nEOF`
      )

      const skills = await Skill.fromSandbox(sandbox, 'skills')
      expect(skills).toHaveLength(2)
      const names = skills.map((s) => s.name).sort()
      expect(names).toStrictEqual(['another-skill', 'test-skill'])
    })

    it('skips subdirectories without SKILL.md', async () => {
      execSync(
        `mkdir -p ${TEST_DIR}/skills/valid && cat > ${TEST_DIR}/skills/valid/SKILL.md << 'EOF'\n${VALID_SKILL_MD}\nEOF`
      )
      execSync(`mkdir -p ${TEST_DIR}/skills/empty`)

      const skills = await Skill.fromSandbox(sandbox, 'skills')
      expect(skills).toHaveLength(1)
      expect(skills[0]!.name).toBe('test-skill')
    })

    it('returns empty array for empty directory', async () => {
      execSync(`mkdir -p ${TEST_DIR}/empty-dir`)
      const skills = await Skill.fromSandbox(sandbox, 'empty-dir')
      expect(skills).toStrictEqual([])
    })

    it('throws for nonexistent path', async () => {
      await expect(Skill.fromSandbox(sandbox, 'nonexistent')).rejects.toThrow()
    })

    it('throws for invalid SKILL.md content', async () => {
      execSync(`mkdir -p ${TEST_DIR}/bad && echo "no frontmatter" > ${TEST_DIR}/bad/SKILL.md`)
      await expect(Skill.fromSandbox(sandbox, 'bad')).rejects.toThrow()
    })
  })

  describe('AgentSkills with sandbox paths', () => {
    it('resolves path-based skills via sandbox in initAgent', async () => {
      execSync(
        `mkdir -p ${TEST_DIR}/skills/my-skill && cat > ${TEST_DIR}/skills/my-skill/SKILL.md << 'EOF'\n${VALID_SKILL_MD}\nEOF`
      )

      const plugin = new AgentSkills({ skills: ['skills'] })
      const agent = createMockAgent({ extra: { sandbox } as never })
      await plugin.initAgent(agent)

      const tools = plugin.getTools()
      expect(tools.length).toBeGreaterThan(0)
    })

    it('resolves a single skill path via sandbox', async () => {
      execSync(
        `mkdir -p ${TEST_DIR}/single-skill && cat > ${TEST_DIR}/single-skill/SKILL.md << 'EOF'\n${VALID_SKILL_MD}\nEOF`
      )

      const plugin = new AgentSkills({ skills: ['single-skill'] })
      const agent = createMockAgent({ extra: { sandbox } as never })
      await plugin.initAgent(agent)

      const tools = plugin.getTools()
      expect(tools.length).toBeGreaterThan(0)
    })

    it('warns on failed path load', async () => {
      const plugin = new AgentSkills({ skills: ['nonexistent'] })
      const agent = createMockAgent({ extra: { sandbox } as never })
      await plugin.initAgent(agent)
    })
  })
})
