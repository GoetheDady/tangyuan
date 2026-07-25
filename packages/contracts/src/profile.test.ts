import { describe, expect, it } from 'vitest'
import {
  agentSkillsStatusSchema,
  getSoulRequestSchema,
  listAgentSkillsRequestSchema,
  profileUpdateResultSchema,
  skillSummarySchema,
  soulContentSchema,
  updateSoulRequestSchema,
  updateUserProfileRequestSchema,
  userProfileContentSchema,
} from './index'

describe('profile schemas', () => {
  it('accepts valid soul content', () => {
    expect(
      soulContentSchema.parse({
        agentId: 'agent-1',
        content: '# Soul\n\nAgent identity rules.',
        updatedAt: '2026-07-17T00:00:00.000Z',
        version: 'sha256:soul-version',
      }),
    ).toEqual({
      agentId: 'agent-1',
      content: '# Soul\n\nAgent identity rules.',
      updatedAt: '2026-07-17T00:00:00.000Z',
      version: 'sha256:soul-version',
    })
  })

  it('accepts valid user profile content', () => {
    expect(
      userProfileContentSchema.parse({
        content: '# User\n\nUser preferences.',
        updatedAt: '2026-07-17T00:00:00.000Z',
        version: 'sha256:user-version',
      }),
    ).toEqual({
      content: '# User\n\nUser preferences.',
      updatedAt: '2026-07-17T00:00:00.000Z',
      version: 'sha256:user-version',
    })
  })

  it('accepts an updated profile result', () => {
    expect(
      profileUpdateResultSchema.parse({
        target: 'soul',
        status: 'updated',
        version: 'sha256:new-version',
      }),
    ).toEqual({
      target: 'soul',
      status: 'updated',
      version: 'sha256:new-version',
    })
  })

  it('accepts a rejected profile result with a structured reason', () => {
    expect(
      profileUpdateResultSchema.parse({
        target: 'user',
        status: 'rejected',
        version: 'sha256:current-version',
        reason: {
          code: 'version-conflict',
          message: '用户画像已被其他会话更新。',
        },
      }),
    ).toEqual({
      target: 'user',
      status: 'rejected',
      version: 'sha256:current-version',
      reason: {
        code: 'version-conflict',
        message: '用户画像已被其他会话更新。',
      },
    })
  })

  it('accepts an invalid-content profile rejection', () => {
    expect(
      profileUpdateResultSchema.parse({
        target: 'soul',
        status: 'rejected',
        version: 'sha256:current-version',
        reason: {
          code: 'invalid-content',
          message: 'Agent 灵魂不能为空。',
        },
      }),
    ).toMatchObject({
      status: 'rejected',
      reason: { code: 'invalid-content' },
    })
  })

  it('rejects empty soul content in update request', () => {
    expect(() =>
      updateSoulRequestSchema.parse({
        agentId: 'agent-1',
        content: '   ',
      }),
    ).toThrow()
  })

  it('accepts valid update soul request', () => {
    expect(
      updateSoulRequestSchema.parse({
        agentId: 'agent-1',
        content: 'New soul content.',
        expectedVersion: 'sha256:observed-version',
      }),
    ).toEqual({
      agentId: 'agent-1',
      content: 'New soul content.',
      expectedVersion: 'sha256:observed-version',
    })
  })

  it('rejects empty user profile content in update request', () => {
    expect(() =>
      updateUserProfileRequestSchema.parse({
        content: '   ',
      }),
    ).toThrow()
  })

  it('accepts valid update user profile request', () => {
    expect(
      updateUserProfileRequestSchema.parse({
        content: 'New user profile.',
      }),
    ).toEqual({ content: 'New user profile.' })
  })

  it('rejects get soul request without agentId', () => {
    expect(() =>
      getSoulRequestSchema.parse({
        agentId: '',
      }),
    ).toThrow()
  })

  it('accepts valid get soul request', () => {
    expect(
      getSoulRequestSchema.parse({
        agentId: 'agent-1',
      }),
    ).toEqual({ agentId: 'agent-1' })
  })

  it('accepts valid skill summary with agent source', () => {
    expect(
      skillSummarySchema.parse({
        name: 'my-skill',
        description: 'A useful skill.',
        source: 'agent',
        path: '/skills/my-skill/SKILL.md',
        hasScripts: false,
      }),
    ).toEqual({
      name: 'my-skill',
      description: 'A useful skill.',
      source: 'agent',
      path: '/skills/my-skill/SKILL.md',
      hasScripts: false,
    })
  })

  it('accepts skill summary with conflict info', () => {
    expect(
      skillSummarySchema.parse({
        name: 'shared-skill',
        description: 'Description.',
        source: 'agent',
        path: '/agents/a1/skills/shared-skill/SKILL.md',
        conflict: {
          overriddenPath: '/skills/shared-skill/SKILL.md',
          overriddenSource: 'shared',
        },
        hasScripts: true,
      }),
    ).toEqual({
      name: 'shared-skill',
      description: 'Description.',
      source: 'agent',
      path: '/agents/a1/skills/shared-skill/SKILL.md',
      conflict: {
        overriddenPath: '/skills/shared-skill/SKILL.md',
        overriddenSource: 'shared',
      },
      hasScripts: true,
    })
  })

  it('rejects skill summary with invalid source', () => {
    expect(() =>
      skillSummarySchema.parse({
        name: 'skill',
        description: 'desc',
        source: 'invalid',
        path: '/path',
        hasScripts: false,
      }),
    ).toThrow()
  })

  it('accepts valid agent skills status', () => {
    expect(
      agentSkillsStatusSchema.parse({
        agentId: 'agent-1',
        skills: [
          {
            name: 'skill-1',
            description: 'A skill.',
            source: 'agent',
            path: '/agents/a1/skills/skill-1/SKILL.md',
            hasScripts: false,
          },
        ],
        sharedSkillsCount: 3,
        agentSkillsCount: 1,
        conflictsCount: 0,
      }),
    ).toEqual({
      agentId: 'agent-1',
      skills: [
        {
          name: 'skill-1',
          description: 'A skill.',
          source: 'agent',
          path: '/agents/a1/skills/skill-1/SKILL.md',
          hasScripts: false,
        },
      ],
      sharedSkillsCount: 3,
      agentSkillsCount: 1,
      conflictsCount: 0,
    })
  })

  it('accepts valid list agent skills request', () => {
    expect(listAgentSkillsRequestSchema.parse({ agentId: 'agent-1' })).toEqual({
      agentId: 'agent-1',
    })
  })

  it('rejects list agent skills request without agentId', () => {
    expect(() => listAgentSkillsRequestSchema.parse({ agentId: '' })).toThrow()
  })
})
