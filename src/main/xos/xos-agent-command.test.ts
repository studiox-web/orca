import { describe, expect, it } from 'vitest'
import {
  buildAgentRunCommand,
  equivalentModel,
  modelFitsAgent,
  nativeFallbackChain,
  replyModelFor,
  shellQuote
} from './xos-agent-command'

const base = {
  root: '/repo',
  promptPath: '/logs/run.prompt.md',
  model: null,
  effort: null,
  lockLane: 'content',
  inboxOnly: false,
  bypassPermissions: false
}

describe('buildAgentRunCommand', () => {
  it('sends the prompt over stdin for both agents (M2)', () => {
    const claude = buildAgentRunCommand({ ...base, agent: 'claude' })
    expect(claude).toContain("claude -p --permission-mode acceptEdits < '/logs/run.prompt.md'")
    expect(claude).not.toContain('$(cat')
    expect(buildAgentRunCommand({ ...base, agent: 'codex' })).toContain("- < '/logs/run.prompt.md'")
  })

  it('keeps every value out of the shell (L1)', () => {
    const command = buildAgentRunCommand({
      ...base,
      agent: 'claude',
      model: '$(touch /tmp/pwned)',
      root: "/repo/o'brien"
    })
    expect(command).toContain("--model '$(touch /tmp/pwned)'")
    expect(command).toContain(`cd '/repo/o'\\''brien'`)
    expect(shellQuote('`id`')).toBe("'`id`'")
  })

  it('bypasses the sandbox only when authority was confirmed (M15)', () => {
    expect(buildAgentRunCommand({ ...base, agent: 'codex' })).toContain('--sandbox workspace-write')
    expect(buildAgentRunCommand({ ...base, agent: 'codex', bypassPermissions: true })).toContain(
      '--dangerously-bypass-approvals-and-sandbox'
    )
    expect(buildAgentRunCommand({ ...base, agent: 'claude', bypassPermissions: true })).toContain(
      '--dangerously-skip-permissions'
    )
  })

  it('refuses an agent with no one-shot mode instead of running Codex (M3)', () => {
    expect(() => buildAgentRunCommand({ ...base, agent: 'gemini' })).toThrow(/not "gemini"/)
  })
})

describe('model routing', () => {
  it('picks the reply model of the agent that runs (M3)', () => {
    expect(replyModelFor('codex')).toBe('gpt-5.4-mini')
    expect(replyModelFor('claude')).toBe('haiku')
    expect(replyModelFor('grok')).toBeNull()
  })

  it('never hands one provider another provider’s model', () => {
    expect(modelFitsAgent('claude', 'gpt-5.5')).toBe(false)
    expect(modelFitsAgent('codex', 'opus')).toBe(false)
    expect(modelFitsAgent('claude', 'claude-opus-4-6')).toBe(true)
    expect(equivalentModel('gpt-5.5', 'claude')).toBe('opus')
  })

  it('derives the fallback chain from allowed agents, or uses the declared one', () => {
    const current = { agent: 'claude', model: 'opus', effort: null }
    expect(nativeFallbackChain(current, ['claude', 'codex', 'gemini'], [])).toEqual([
      { agent: 'codex', model: 'gpt-5.5', effort: null }
    ])
    expect(nativeFallbackChain(current, ['claude'], ['codex:gpt-5.4-mini'])).toEqual([
      { agent: 'codex', model: 'gpt-5.4-mini', effort: null }
    ])
  })
})
