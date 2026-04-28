import { describe, it, expect, vi } from 'vitest'
import { Skill } from '../skill.js'
import { AgentSkills } from '../agent-skills.js'
import type { Sandbox } from '../../../sandbox/base.js'
import type { FileInfo } from '../../../sandbox/base.js'
import type { LocalAgent } from '../../../types/agent.js'
import { StateStore } from '../../../state-store.js'
import { ToolRegistry } from '../../../registry/tool-registry.js'

const VALID_SKILL_MD = `---
name: test-skill
description: A test skill
---
# Instructions
Do the thing.
`

function createMockSandbox(files: Record<string, string> = {}): Sandbox {
  return {
    readFile: vi.fn(async (path: string): Promise<Uint8Array> => {
      const content = files[path]
      if (content == null) throw new Error(`File not found: ${path}`)
      return new TextEncoder().encode(content)
    }),
    readText: vi.fn(async (path: string): Promise<string> => {
      const content = files[path]
      if (content == null) throw new Error(`File not found: ${path}`)
      return content
    }),
    writeFile: vi.fn(),
    writeText: vi.fn(),
    removeFile: vi.fn(),
    listFiles: vi.fn(async (path: string): Promise<FileInfo[]> => {
      const prefix = path.endsWith('/') ? path : `${path}/`
      const children = new Set<string>()
      for (const key of Object.keys(files)) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length)
          const firstSegment = rest.split('/')[0]
          if (firstSegment != null) children.add(firstSegment)
        }
      }
      return Array.from(children).map((name) => {
        const childPath = `${prefix}${name}`
        const hasChildren = Object.keys(files).some((k) => k.startsWith(`${childPath}/`))
        return { name, isDir: hasChildren }
      })
    }),
    execute: vi.fn(),
    executeCode: vi.fn(),
    executeStreaming: vi.fn() as never,
    executeCodeStreaming: vi.fn() as never,
  } as unknown as Sandbox
}

function createMockAgent(sandbox: Sandbox, id = 'test-agent'): LocalAgent {
  return {
    id,
    sandbox,
    appState: new StateStore(),
    messages: [],
    toolRegistry: new ToolRegistry(),
    systemPrompt: 'test',
    cancelSignal: new AbortController().signal,
    addHook: vi.fn().mockReturnValue(() => {}),
  } as unknown as LocalAgent
}

describe('Skill.fromSandbox', () => {
  it('loads a skill from a sandbox directory', async () => {
    const sandbox = createMockSandbox({
      '/skills/my-skill/SKILL.md': VALID_SKILL_MD,
    })

    const skill = await Skill.fromSandbox(sandbox, '/skills/my-skill')
    expect(skill.name).toBe('test-skill')
    expect(skill.description).toBe('A test skill')
    expect(skill.instructions).toContain('Do the thing.')
  })

  it('loads from a direct SKILL.md path', async () => {
    const sandbox = createMockSandbox({
      '/skills/my-skill/SKILL.md': VALID_SKILL_MD,
    })

    const skill = await Skill.fromSandbox(sandbox, '/skills/my-skill/SKILL.md')
    expect(skill.name).toBe('test-skill')
  })

  it('falls back to lowercase skill.md', async () => {
    const sandbox = createMockSandbox({
      '/skills/my-skill/skill.md': VALID_SKILL_MD,
    })

    const skill = await Skill.fromSandbox(sandbox, '/skills/my-skill')
    expect(skill.name).toBe('test-skill')
  })

  it('throws when no SKILL.md exists', async () => {
    const sandbox = createMockSandbox({})
    await expect(Skill.fromSandbox(sandbox, '/empty')).rejects.toThrow('no SKILL.md found')
  })
})

describe('Skill.fromSandboxDirectory', () => {
  it('loads multiple skills from subdirectories', async () => {
    const sandbox = createMockSandbox({
      '/skills/skill-a/SKILL.md': '---\nname: skill-a\ndescription: Skill A\n---\nInstructions for A',
      '/skills/skill-b/SKILL.md': '---\nname: skill-b\ndescription: Skill B\n---\nInstructions for B',
    })

    const skills = await Skill.fromSandboxDirectory(sandbox, '/skills')
    expect(skills).toHaveLength(2)
    expect(skills.map((s) => s.name).sort()).toStrictEqual(['skill-a', 'skill-b'])
  })

  it('skips non-directory entries', async () => {
    const sandbox = createMockSandbox({
      '/skills/skill-a/SKILL.md': VALID_SKILL_MD,
    })
    // listFiles returns the file entry as non-dir
    vi.mocked(sandbox.listFiles).mockResolvedValueOnce([
      { name: 'skill-a', isDir: true },
      { name: 'readme.txt', isDir: false },
    ])

    const skills = await Skill.fromSandboxDirectory(sandbox, '/skills')
    expect(skills).toHaveLength(1)
  })

  it('returns empty array on listFiles failure', async () => {
    const sandbox = createMockSandbox({})
    vi.mocked(sandbox.listFiles).mockRejectedValueOnce(new Error('access denied'))

    const skills = await Skill.fromSandboxDirectory(sandbox, '/nope')
    expect(skills).toStrictEqual([])
  })
})

describe('AgentSkills sandbox sources', () => {
  it('resolves sandbox: prefixed sources during initAgent', async () => {
    const sandbox = createMockSandbox({
      '/home/skills/my-skill/SKILL.md': VALID_SKILL_MD,
    })
    const agent = createMockAgent(sandbox)

    const plugin = new AgentSkills({
      skills: ['sandbox:/home/skills/my-skill'],
    })

    await plugin.initAgent(agent)

    const skills = await plugin.getAvailableSkills(agent)
    expect(skills).toHaveLength(1)
    expect(skills[0]!.name).toBe('test-skill')
  })

  it('resolves sandbox directory sources', async () => {
    const sandbox = createMockSandbox({
      '/home/skills/skill-a/SKILL.md': '---\nname: skill-a\ndescription: A\n---\nDo A',
      '/home/skills/skill-b/SKILL.md': '---\nname: skill-b\ndescription: B\n---\nDo B',
    })
    const agent = createMockAgent(sandbox)

    const plugin = new AgentSkills({
      skills: ['sandbox:/home/skills'],
    })

    await plugin.initAgent(agent)

    const skills = await plugin.getAvailableSkills(agent)
    expect(skills).toHaveLength(2)
  })

  it('mixes filesystem and sandbox sources', async () => {
    const localSkill = new Skill({ name: 'local-skill', description: 'local' })
    const sandbox = createMockSandbox({
      '/sandbox/skill/SKILL.md': '---\nname: sandbox-skill\ndescription: from sandbox\n---\nInstructions',
    })
    const agent = createMockAgent(sandbox)

    const plugin = new AgentSkills({
      skills: [localSkill, 'sandbox:/sandbox/skill'],
    })

    await plugin.initAgent(agent)

    const skills = await plugin.getAvailableSkills(agent)
    expect(skills).toHaveLength(2)
    expect(skills.map((s) => s.name).sort()).toStrictEqual(['local-skill', 'sandbox-skill'])
  })

  it('rejects sandbox sources in setAvailableSkills', () => {
    const plugin = new AgentSkills({ skills: [] })
    expect(() => plugin.setAvailableSkills(['sandbox:/nope'])).toThrow(
      'Sandbox sources are not supported in setAvailableSkills'
    )
  })
})

describe('AgentSkills per-agent skill isolation', () => {
  it('two agents with different sandboxes get different skill catalogs', async () => {
    const sandboxA = createMockSandbox({
      '/skills/docker-skill/SKILL.md': '---\nname: docker-skill\ndescription: Docker skill\n---\nDocker instructions',
    })
    const sandboxB = createMockSandbox({
      '/skills/s3-skill/SKILL.md': '---\nname: s3-skill\ndescription: S3 skill\n---\nS3 instructions',
    })

    const agentA = createMockAgent(sandboxA, 'agent-a')
    const agentB = createMockAgent(sandboxB, 'agent-b')

    const plugin = new AgentSkills({
      skills: ['sandbox:/skills'],
    })

    await plugin.initAgent(agentA)
    await plugin.initAgent(agentB)

    // Agent A should only see docker-skill
    const skillsA = await plugin.getAvailableSkills(agentA)
    expect(skillsA).toHaveLength(1)
    expect(skillsA[0]!.name).toBe('docker-skill')

    // Agent B should only see s3-skill
    const skillsB = await plugin.getAvailableSkills(agentB)
    expect(skillsB).toHaveLength(1)
    expect(skillsB[0]!.name).toBe('s3-skill')
  })

  it('shared base skills are present for all agents, sandbox skills are per-agent', async () => {
    const baseSkill = new Skill({ name: 'shared-skill', description: 'shared' })

    const sandboxA = createMockSandbox({
      '/skills/skill-a/SKILL.md': '---\nname: skill-a\ndescription: A\n---\nA',
    })
    const sandboxB = createMockSandbox({
      '/skills/skill-b/SKILL.md': '---\nname: skill-b\ndescription: B\n---\nB',
    })

    const agentA = createMockAgent(sandboxA, 'agent-a')
    const agentB = createMockAgent(sandboxB, 'agent-b')

    const plugin = new AgentSkills({
      skills: [baseSkill, 'sandbox:/skills'],
    })

    await plugin.initAgent(agentA)
    await plugin.initAgent(agentB)

    // Agent A: shared + skill-a
    const skillsA = await plugin.getAvailableSkills(agentA)
    expect(skillsA.map((s) => s.name).sort()).toStrictEqual(['shared-skill', 'skill-a'])

    // Agent B: shared + skill-b
    const skillsB = await plugin.getAvailableSkills(agentB)
    expect(skillsB.map((s) => s.name).sort()).toStrictEqual(['shared-skill', 'skill-b'])
  })

  it('overlapping skill names in different sandboxes do not cross-contaminate', async () => {
    const sandboxA = createMockSandbox({
      '/skills/common/SKILL.md': '---\nname: common\ndescription: Version A\n---\nInstructions A',
    })
    const sandboxB = createMockSandbox({
      '/skills/common/SKILL.md': '---\nname: common\ndescription: Version B\n---\nInstructions B',
    })

    const agentA = createMockAgent(sandboxA, 'agent-a')
    const agentB = createMockAgent(sandboxB, 'agent-b')

    const plugin = new AgentSkills({
      skills: ['sandbox:/skills'],
    })

    await plugin.initAgent(agentA)
    await plugin.initAgent(agentB)

    const skillsA = await plugin.getAvailableSkills(agentA)
    const skillsB = await plugin.getAvailableSkills(agentB)

    expect(skillsA).toHaveLength(1)
    expect(skillsB).toHaveLength(1)

    // Each agent should have ITS OWN version of the 'common' skill
    expect(skillsA[0]!.description).toBe('Version A')
    expect(skillsA[0]!.instructions).toContain('Instructions A')
    expect(skillsB[0]!.description).toBe('Version B')
    expect(skillsB[0]!.instructions).toContain('Instructions B')
  })

  it('getAvailableSkills without agent returns only base skills', async () => {
    const baseSkill = new Skill({ name: 'base-skill', description: 'base' })
    const sandbox = createMockSandbox({
      '/skills/sandbox-skill/SKILL.md': '---\nname: sandbox-skill\ndescription: sandbox\n---\nInstructions',
    })
    const agent = createMockAgent(sandbox)

    const plugin = new AgentSkills({
      skills: [baseSkill, 'sandbox:/skills'],
    })

    // Before initAgent — only base skills
    const beforeInit = await plugin.getAvailableSkills()
    expect(beforeInit).toHaveLength(1)
    expect(beforeInit[0]!.name).toBe('base-skill')

    await plugin.initAgent(agent)

    // With agent — base + sandbox
    const withAgent = await plugin.getAvailableSkills(agent)
    expect(withAgent).toHaveLength(2)

    // Without agent — still only base
    const withoutAgent = await plugin.getAvailableSkills()
    expect(withoutAgent).toHaveLength(1)
    expect(withoutAgent[0]!.name).toBe('base-skill')
  })

  it('setAvailableSkills resets per-agent caches', async () => {
    const sandbox = createMockSandbox({
      '/skills/sandbox-skill/SKILL.md': '---\nname: sandbox-skill\ndescription: sandbox\n---\nInstructions',
    })
    const agent = createMockAgent(sandbox)

    const plugin = new AgentSkills({
      skills: ['sandbox:/skills'],
    })

    await plugin.initAgent(agent)
    const before = await plugin.getAvailableSkills(agent)
    expect(before).toHaveLength(1)

    // Replace all skills — should clear per-agent caches
    const newSkill = new Skill({ name: 'new-skill', description: 'new' })
    plugin.setAvailableSkills([newSkill])

    // Agent's cache should be gone — falls back to new base skills
    const after = await plugin.getAvailableSkills(agent)
    expect(after).toHaveLength(1)
    expect(after[0]!.name).toBe('new-skill')
  })
})
