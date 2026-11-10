import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CoordinatedGenerationFencedError,
  CoordinatedProgressLedger,
  type CoordinatedDurableBoundary,
  type CoordinatedLedgerSnapshot
} from './coordinated-automation-progress-ledger'
import {
  CoordinatedProgressConflictError,
  CoordinatedProgressUnreadableError,
  createFileCoordinatedRunProgressStore
} from './coordinated-automation-progress-store'

const DIGEST = `sha256:${'a'.repeat(64)}`

function snapshot(canonicalDigest = DIGEST): CoordinatedLedgerSnapshot {
  return {
    canonicalDigest,
    resolvedChildren: [
      { childDefinitionId: 'draft', enabled: true },
      { childDefinitionId: 'removed', enabled: false }
    ]
  }
}

describe('coordinated progress ledger', () => {
  let root: string
  const boundaries: CoordinatedDurableBoundary[] = []

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'coord-progress-'))
    boundaries.length = 0
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  function claim(store = createFileCoordinatedRunProgressStore(root), digest = DIGEST) {
    return CoordinatedProgressLedger.claim({
      store,
      automationRunId: 'run-1',
      orchestrationRunId: 'run_000000000001',
      snapshot: snapshot(digest),
      now: 1000,
      boundary: (boundary) => boundaries.push(boundary)
    })
  }

  it('creates one pending stage per enabled child and reports each durable write', () => {
    const ledger = claim()
    expect(Object.keys(ledger.progress.stages)).toEqual(['draft'])
    expect(ledger.progress).toMatchObject({ generation: 1, sequence: 0, startedAt: 1000 })
    ledger.update('noop', (progress) => progress)
    ledger.update('touch', (progress) => ({ ...progress, spentCostUsd: 2 }))
    expect(boundaries).toEqual(['progress.after-write', 'progress.after-write'])
    expect(createFileCoordinatedRunProgressStore(root).read('run-1')?.spentCostUsd).toBe(2)
  })

  it('fences an older generation once a replacement coordinator claims the run', () => {
    const older = claim()
    const newer = claim()
    expect(newer.generation).toBe(2)
    expect(() => older.update('late', (p) => ({ ...p, spentCostUsd: 9 }))).toThrow(
      CoordinatedGenerationFencedError
    )
    expect(newer.update('ok', (p) => ({ ...p, spentCostUsd: 1 })).spentCostUsd).toBe(1)
  })

  it('rejects a stale compare-and-swap write', () => {
    const store = createFileCoordinatedRunProgressStore(root)
    const ledger = claim(store)
    expect(() => store.write({ ...ledger.progress, sequence: 5 }, 3)).toThrow(
      CoordinatedProgressConflictError
    )
  })

  it('refuses progress recorded for a different frozen snapshot', () => {
    claim()
    expect(() => claim(undefined, `sha256:${'b'.repeat(64)}`)).toThrow(/another snapshot/)
  })

  it('fails closed on an unreadable progress document instead of resetting it', () => {
    claim()
    const file = readdirSync(root).find((name) => name.endsWith('.json'))!
    writeFileSync(join(root, file), '{"schemaVersion":1,"automationRunId":"run-1"}')
    expect(() => claim()).toThrow(CoordinatedProgressUnreadableError)
  })
})
