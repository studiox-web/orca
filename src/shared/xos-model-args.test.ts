import { describe, expect, it } from 'vitest'
import { parseExtraAgentArgs } from './automation-extra-agent-args'
import { readXosModelArgs, writeXosModelArgs, xosModelArgsSupported } from './xos-model-args'

describe('xos model args', () => {
  it('reads Claude, Codex and Grok model/effort flags, including inline values', () => {
    expect(readXosModelArgs('claude', '--model opus --effort high')).toEqual({
      model: 'opus',
      effort: 'high'
    })
    expect(readXosModelArgs('codex', '-m gpt-5.5 -c model_reasoning_effort=xhigh')).toEqual({
      model: 'gpt-5.5',
      effort: 'xhigh'
    })
    expect(readXosModelArgs('grok', '--model=grok-5 --reasoning-effort low')).toEqual({
      model: 'grok-5',
      effort: 'low'
    })
    expect(readXosModelArgs('claude', '')).toEqual({ model: null, effort: null })
  })

  it('rewrites only model/effort and keeps other extras', () => {
    const next = writeXosModelArgs('claude', '--add-dir /tmp/x --model sonnet', {
      model: 'opus',
      effort: 'max'
    })
    expect(next).toBe('--model opus --effort max --add-dir /tmp/x')
    expect(writeXosModelArgs('claude', next!, { model: null, effort: null })).toBe(
      '--add-dir /tmp/x'
    )
  })

  it('writes Codex effort as a config override that upstream validation accepts', () => {
    const next = writeXosModelArgs('codex', '', { model: 'gpt-5.5', effort: 'high' })
    expect(next).toBe('-m gpt-5.5 -c model_reasoning_effort=high')
    expect(parseExtraAgentArgs({ agent: 'codex', extraAgentArgs: next! }).ok).toBe(true)
  })

  it('drops effort for agents without an effort flag and refuses unsupported agents', () => {
    expect(writeXosModelArgs('cursor', '', { model: 'gpt-5', effort: 'high' })).toBe(
      '--model gpt-5'
    )
    expect(xosModelArgsSupported('antigravity' as never)).toBe(false)
    expect(writeXosModelArgs('antigravity' as never, '', { model: 'x', effort: null })).toBeNull()
  })
})
