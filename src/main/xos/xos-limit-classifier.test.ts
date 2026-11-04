import { describe, expect, it } from 'vitest'
import { classifyRunScreen, describeLimit } from './xos-limit-classifier'

const filler = (count: number): string =>
  Array.from({ length: count }, (_, index) => `working on step ${index}`).join('\n')

describe('classifyRunScreen', () => {
  it('detects the Claude limit banner with its reset time', () => {
    const verdict = classifyRunScreen(
      `${filler(5)}\n⎿  You've hit your limit · resets 3pm (America/Vancouver)\n> `
    )
    expect(verdict?.kind).toBe('usage-limit')
    expect(verdict?.resetHint).toMatch(/^resets 3pm/)
    expect(describeLimit(verdict!)).toMatch(/^usage limit \(resets 3pm/)
  })

  it('detects the Codex usage-limit banner and 429 retry exhaustion', () => {
    expect(
      classifyRunScreen("■ You've hit your usage limit. Try again in 3 days.")?.resetHint
    ).toBe('Try again in 3 days.')
    expect(
      classifyRunScreen('■ stream error: exceeded retry limit, last status: 429 Too Many Requests')
        ?.kind
    ).toBe('usage-limit')
  })

  it('detects the 2026-06-11 monthly spend-cap banner, overload, auth and a missing binary', () => {
    expect(
      classifyRunScreen('You have hit your monthly spend limit for this organization.')?.kind
    ).toBe('usage-limit')
    expect(classifyRunScreen('API Error: 529 {"type":"overloaded_error"}')?.kind).toBe('overloaded')
    expect(classifyRunScreen('Invalid API key · Please run /login')?.kind).toBe('auth')
    expect(classifyRunScreen('bash: codex: command not found')?.kind).toBe('missing-binary')
  })

  it('ignores limit words far above the bottom of the screen and in ordinary work', () => {
    expect(classifyRunScreen(`You've hit your limit · resets 3pm\n${filler(40)}`)).toBeNull()
    expect(classifyRunScreen('Fixed the 429 handling in the API client; tests pass.')).toBeNull()
    expect(classifyRunScreen('bash: jq: command not found')).toBeNull()
    expect(classifyRunScreen('')).toBeNull()
  })

  it('reads generic wording only as a line of its own, never inside prose', () => {
    expect(classifyRunScreen('The login page shows not logged in for guests.')).toBeNull()
    expect(classifyRunScreen('Handled the 429 Too Many Requests path in the client.')).toBeNull()
    expect(classifyRunScreen('Not logged in · run claude to sign in')?.kind).toBe('auth')
    expect(classifyRunScreen('Error: 429 Too Many Requests')?.kind).toBe('usage-limit')
  })

  it('treats a successful exit as a limit only when the output is just the banner (RT4)', () => {
    const banner = "You've hit your usage limit. Try again in 3 days."
    expect(classifyRunScreen(`${banner}\n`, { exitCode: 0 })?.kind).toBe('usage-limit')
    expect(classifyRunScreen(`${filler(30)}\n${banner}`, { exitCode: 0 })).toBeNull()
    expect(classifyRunScreen(`${filler(30)}\n${banner}`, { exitCode: 1 })?.kind).toBe('usage-limit')
  })
})
