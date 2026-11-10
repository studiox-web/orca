import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CoordinatedRunProgressSchema } from '../../shared/coordinated-automation-progress-schemas'
import type { CoordinatedRunProgress } from '../../shared/coordinated-automation-progress-types'

export class CoordinatedProgressUnreadableError extends Error {
  constructor(automationRunId: string, reason: string) {
    super(`Coordinated progress for run "${automationRunId}" is unreadable: ${reason}`)
    this.name = 'CoordinatedProgressUnreadableError'
  }
}

export class CoordinatedProgressConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CoordinatedProgressConflictError'
  }
}

/** Durable per-run progress with compare-and-swap writes. */
export type CoordinatedRunProgressStore = {
  read: (automationRunId: string) => CoordinatedRunProgress | null
  write: (next: CoordinatedRunProgress, expectedSequence: number) => void
}

function assertSequence(
  current: CoordinatedRunProgress | null,
  next: CoordinatedRunProgress,
  expectedSequence: number
): void {
  const stored = current?.sequence ?? -1
  if (stored !== expectedSequence || next.sequence !== expectedSequence + 1) {
    throw new CoordinatedProgressConflictError(
      `Progress for run "${next.automationRunId}" moved to sequence ${stored}; expected ${expectedSequence}.`
    )
  }
}

function parseProgress(automationRunId: string, text: string): CoordinatedRunProgress {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new CoordinatedProgressUnreadableError(
      automationRunId,
      error instanceof Error ? error.message : String(error)
    )
  }
  const parsed = CoordinatedRunProgressSchema.safeParse(raw)
  if (!parsed.success || parsed.data.automationRunId !== automationRunId) {
    throw new CoordinatedProgressUnreadableError(
      automationRunId,
      parsed.success
        ? 'run identity mismatch'
        : parsed.error.issues.map((i) => i.message).join('; ')
    )
  }
  return parsed.data
}

/** One JSON document per run, replaced atomically by rename. */
export function createFileCoordinatedRunProgressStore(root: string): CoordinatedRunProgressStore {
  const pathFor = (automationRunId: string): string =>
    join(root, `${createHash('sha256').update(automationRunId).digest('hex')}.json`)
  const read = (automationRunId: string): CoordinatedRunProgress | null => {
    let text: string
    try {
      text = readFileSync(pathFor(automationRunId), 'utf8')
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return null
      }
      throw error
    }
    return parseProgress(automationRunId, text)
  }
  return {
    read,
    write: (next, expectedSequence) => {
      assertSequence(read(next.automationRunId), next, expectedSequence)
      CoordinatedRunProgressSchema.parse(next)
      mkdirSync(root, { recursive: true, mode: 0o700 })
      const path = pathFor(next.automationRunId)
      const temporary = `${path}.next`
      writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600
      })
      renameSync(temporary, path)
    }
  }
}

/** Process-local store for callers that do not need restart durability. */
export function createMemoryCoordinatedRunProgressStore(): CoordinatedRunProgressStore {
  const documents = new Map<string, string>()
  return {
    read: (automationRunId) => {
      const text = documents.get(automationRunId)
      return text === undefined ? null : parseProgress(automationRunId, text)
    },
    write: (next, expectedSequence) => {
      const text = documents.get(next.automationRunId)
      assertSequence(
        text === undefined ? null : parseProgress(next.automationRunId, text),
        next,
        expectedSequence
      )
      CoordinatedRunProgressSchema.parse(next)
      documents.set(next.automationRunId, JSON.stringify(next))
    }
  }
}
