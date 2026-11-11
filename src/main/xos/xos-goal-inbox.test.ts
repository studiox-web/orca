import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { collectGoalInbox, markGoalInboxRead } from './xos-goal-inbox'

let dir: string
let inbox: string

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), 'xos-inbox-')), 'writer')
  inbox = join(dir, 'inbox')
  mkdirSync(inbox, { recursive: true })
})

afterEach(() => rmSync(join(dir, '..'), { recursive: true, force: true }))

const message = (body: string, status = 'open'): string =>
  `---\nfrom: operator\nstatus: ${status}\n---\n${body}\n`

describe('goal inbox (M1)', () => {
  it('keeps a message longer than the prompt excerpt whole when marking it read', () => {
    const path = join(inbox, 'long.md')
    const body = 'x'.repeat(100 * 1024)
    writeFileSync(path, message(body))
    const collected = collectGoalInbox(dir, 'writer')
    expect(collected.formattedMessages.length).toBeLessThan(40 * 1024)
    markGoalInboxRead(collected.messagePaths, 'writer')
    const after = readFileSync(path, 'utf8')
    expect(after).toContain('read_by: writer')
    expect(after).toContain(body)
  })

  it('injects only open, unanswered messages', () => {
    writeFileSync(join(inbox, 'a.md'), message('still open'))
    writeFileSync(join(inbox, 'b.md'), message('all done', 'closed'))
    writeFileSync(
      join(inbox, 'c.md'),
      '---\nstatus: open\nresponded_at: 2026-01-01\n---\nanswered\n'
    )
    const collected = collectGoalInbox(dir, 'writer')
    expect(collected.openCount).toBe(1)
    expect(collected.formattedMessages).toContain('still open')
    expect(collected.formattedMessages).not.toContain('all done')
    expect(collected.formattedMessages).not.toContain('answered')
  })

  it('caps the total, and what it left out stays unread for a later run', () => {
    for (const name of ['a', 'b', 'c']) {
      writeFileSync(join(inbox, `${name}.md`), message('y'.repeat(30 * 1024)))
    }
    const collected = collectGoalInbox(dir, 'writer')
    expect(collected.openCount).toBe(3)
    expect(collected.messagePaths).toHaveLength(1)
    expect(collected.formattedMessages).toContain('2 more open message(s) omitted')
  })

  it('marks only messages from outside the project as external (M15)', () => {
    mkdirSync(join(dir, '..', 'editor'))
    writeFileSync(join(dir, '..', 'editor', 'GOAL.md'), 'x')
    writeFileSync(join(inbox, 'a.md'), '---\nfrom: editor\nstatus: open\n---\nhi\n')
    expect(collectGoalInbox(dir, 'writer').hasExternalMessages).toBe(false)
    writeFileSync(join(inbox, 'b.md'), '---\nfrom: whatsapp-bot\nstatus: open\n---\nhi\n')
    expect(collectGoalInbox(dir, 'writer').hasExternalMessages).toBe(true)
  })
})
