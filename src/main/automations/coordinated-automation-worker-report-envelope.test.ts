import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../runtime/orchestration/db'
import { createRootDispatch } from '../runtime/orchestration/db/root-dispatch-test-fixture'
import { reconcileLifecycleMessage } from '../runtime/orchestration/lifecycle-reconciliation'
import {
  COORDINATED_WORKER_REPORT_MARKER,
  decodeWorkerReportResult,
  encodeCoordinatedWorkerReport,
  structuredReportDigest
} from './coordinated-automation-worker-report-envelope'

const report = {
  schemaVersion: 1,
  dispatchId: 'ctx_aaaaaaaaaaaa',
  summary: 'Draft written',
  reportMarkdown: '## Notes\nAll good',
  checks: []
}

describe('coordinated worker report envelope', () => {
  let db: OrchestrationDb | undefined

  afterEach(() => db?.close())

  it('keeps the readable report first and round-trips the structured result', () => {
    const encoded = encodeCoordinatedWorkerReport(report, 'Required check missing')
    expect(encoded.startsWith('Required check missing\n\nDraft written\n\n## Notes')).toBe(true)
    expect(encoded).toContain(COORDINATED_WORKER_REPORT_MARKER)
    expect(decodeWorkerReportResult(encoded)).toEqual({
      kind: 'structured',
      envelopeVersion: 1,
      source: 'coordinated',
      report,
      readable: 'Required check missing\n\nDraft written\n\n## Notes\nAll good'
    })
  })

  it('digests key order independently so a duplicate delivery has the same identity', () => {
    const reordered = Object.fromEntries(Object.entries(report).toReversed())
    expect(structuredReportDigest(reordered)).toBe(structuredReportDigest(report))
    expect(structuredReportDigest({ ...report, summary: 'other' })).not.toBe(
      structuredReportDigest(report)
    )
  })

  it('admits pre-envelope JSON results for compatibility and rejects unknown versions', () => {
    expect(decodeWorkerReportResult(JSON.stringify(report))).toMatchObject({
      kind: 'structured',
      envelopeVersion: 0,
      source: 'legacy_json'
    })
    const future = `readable\n\n${COORDINATED_WORKER_REPORT_MARKER}\n${JSON.stringify({
      provenance: 'coordinated_worker_report',
      envelopeVersion: 2,
      structuredResult: report
    })}`
    expect(decodeWorkerReportResult(future)).toMatchObject({
      kind: 'unsupported',
      readable: 'readable'
    })
    expect(decodeWorkerReportResult('plain words')).toEqual({
      kind: 'readable_only',
      readable: 'plain words'
    })
  })

  it('carries a structured result through the native worker_done path beside the body', () => {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ runId: 'run_legacy_local', spec: 'work' })
    const dispatch = createRootDispatch(db, task.id, 'term_worker')
    const message = db.insertMessage({
      runId: 'run_legacy_local',
      from: 'term_worker',
      to: 'term_coordinator',
      subject: 'Done',
      body: 'Readable summary for people',
      type: 'worker_done',
      payload: JSON.stringify({
        taskId: task.id,
        dispatchId: dispatch.id,
        outcome: 'succeeded',
        structuredResult: report
      })
    })

    expect(reconcileLifecycleMessage(db, message).action).toBe('completed')
    expect(decodeWorkerReportResult(db.getTask(task.id)!.result)).toEqual({
      kind: 'structured',
      envelopeVersion: 1,
      source: 'worker_done',
      report,
      readable: 'Readable summary for people'
    })
  })

  it('leaves plain worker_done results readable-only and unchanged in shape', () => {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ runId: 'run_legacy_local', spec: 'work' })
    const dispatch = createRootDispatch(db, task.id, 'term_worker')
    const message = db.insertMessage({
      runId: 'run_legacy_local',
      from: 'term_worker',
      to: 'term_coordinator',
      subject: 'Done',
      body: 'Just text',
      type: 'worker_done',
      payload: JSON.stringify({ taskId: task.id, dispatchId: dispatch.id, outcome: 'succeeded' })
    })

    expect(reconcileLifecycleMessage(db, message).action).toBe('completed')
    const result = db.getTask(task.id)!.result!
    expect(JSON.parse(result)).not.toHaveProperty('structuredResult')
    expect(decodeWorkerReportResult(result)).toEqual({
      kind: 'readable_only',
      readable: 'Just text'
    })
  })
})
