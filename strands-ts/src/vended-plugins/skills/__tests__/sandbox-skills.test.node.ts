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

function createMockAgent(sandbox: Sandbox): LocalAgent {
  return {
    id: 'test-agent',
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

    const skills = await plugin.getAvailableSkills()
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

    const skills = await plugin.getAvailableSkills()
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

    const skills = await plugin.getAvailableSkills()
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
