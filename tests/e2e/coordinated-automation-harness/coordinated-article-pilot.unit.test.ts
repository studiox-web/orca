import '../../../src/main/runtime/rpc/unused-default-rpc-methods.test-fixture'
import { writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { testState } from '../../../src/main/persistence/persistence-test-harness'
import { createCoordinatedRunRpcFixture } from '../../../src/main/runtime/coordinated-run-rpc.test-support'
import { decodeWorkerReportResult } from '../../../src/main/automations/coordinated-automation-worker-report-envelope'
import { currentWorkspaceArtifactDigest } from '../../../src/main/automations/coordinated-automation-artifact-validation'
import { ARTICLE_ID } from './coordinated-article-pilot-package'
import { prepareArticlePilotApproval } from './coordinated-article-pilot-acceptance'
import {
  articlePilotArtifactReport,
  FIXTURE_DRAFT,
  articlePilotFixtureDefinition,
  articlePilotFixturePromptResolver,
  scriptArticlePilotFixture
} from './coordinated-article-pilot-fixture'
import type { RecoveryEnv } from './coordinated-automation-recovery-env'

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))
vi.mock('../../../src/main/telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../../../src/main/telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

let fixture: Awaited<ReturnType<typeof createCoordinatedRunRpcFixture>> | undefined
afterEach(async () => {
  await fixture?.dispose()
  fixture = undefined
})

async function setup() {
  fixture = await createCoordinatedRunRpcFixture({
    injection: {
      promptResolver: articlePilotFixturePromptResolver,
      get workspacePath() {
        return join(testState.dir, '..', 'artifacts')
      }
    }
  })
  scriptArticlePilotFixture(fixture.env)
  const f = fixture
  const { automationId } = f.env.createDefinitionOnly(articlePilotFixtureDefinition())
  return {
    ...f,
    automationId,
    startRequest: { ...f.startRequest, automationId },
    selection(runId: string) {
      return { ...f.selection(runId), automationId }
    }
  }
}

async function heldPilot(configure?: (env: RecoveryEnv) => void) {
  const f = await setup()
  configure?.(f.env)
  const started = await f.runtime.startCoordinatedFakeRun(f.startRequest)
  expect(started.state, started.reason ?? undefined).toBe('waiting')
  const runId = started.view.inspection.automationRunId
  const view = () => f.runtime.inspectCoordinatedRun(f.selection(runId)).view
  const run = view().inspection
  const selection = {
    runtimeId: view().runtimeId,
    automationId: run.automationId,
    automationRunId: runId,
    orchestrationRunId: run.orchestrationRunId!,
    definitionRevision: run.definitionRevision,
    canonicalDigest: run.canonicalDigest!,
    targetExecutionAuthority: run.targetExecutionAuthority!
  }
  const approval = () =>
    prepareArticlePilotApproval({ selection, view: view(), workspacePath: f.env.workspacePath })
  return { ...f, runId, view, boundSelection: selection, approval }
}

it('holds independent digest-bound review, exposes real native reports/artifacts, then issues ready_for_review', async () => {
  const f = await heldPilot()
  expect(f.view().inspection.receipt.kind).toBe('absent')
  expect(f.view().inspection.stages).toHaveLength(4)
  for (const stage of f.view().inspection.stages) {
    expect(stage.taskId).toBeTruthy()
    expect(stage.mappedDispatchId).toBeTruthy()
    expect(stage.sessionTarget.kind).toBe('unavailable')
  }
  const request = f.approval()
  const response = await f.rpc('automation.resolveCoordinatedGate', request)
  expect(response).toMatchObject({ ok: true })
  const receipt = f.view().inspection.receipt
  expect(receipt.kind).toBe('available')
  if (receipt.kind !== 'available') {
    throw new Error('Expected native receipt')
  }
  expect(receipt.receipt.finalState).toBe('ready_for_review')
  expect(receipt.receipt.effectReceipts).toEqual([])
  expect(
    receipt.receipt.acceptanceResults.find((result) => result.criterionId === 'draft-digest')
      ?.evidence
  ).toContain(currentWorkspaceArtifactDigest('outputs/draft.md', f.env.workspacePath))
  expect(f.env.maxRunning).toBe(1)
  expect(request.note).toContain(ARTICLE_ID)
  const editor = f
    .view()
    .inspection.stages.find((stage) => stage.childDefinitionId === 'editor-review')!
  expect(editor.evidence.kind).toBe('available')
  const decoded = decodeWorkerReportResult(f.env.db.getTask(editor.taskId!)!.result)
  expect(decoded.kind).toBe('structured')
})

it('keeps the same manual run and held attempt after duplicate starts and reconciles', async () => {
  const f = await heldPilot()
  const first = f.approval()
  const duplicate = await f.runtime.startCoordinatedFakeRun(f.startRequest)
  expect(duplicate.created).toBe(false)
  expect(duplicate.view.inspection.automationRunId).toBe(f.runId)
  await f.runtime.reconcileCoordinatedFakeRun(f.selection(f.runId))
  expect(f.approval()).toEqual(first)
  expect(f.env.dispatchIds(f.runId, 'write-draft')).toHaveLength(1)
  expect(f.env.dispatchIds(f.runId, 'editor-review')).toHaveLength(1)
})

it('rejects changed draft bytes in both pilot preview and the native gate', async () => {
  const f = await heldPilot()
  const request = f.approval()
  writeFileSync(join(f.env.workspacePath, 'outputs/draft.md'), 'changed after independent review')
  expect(f.approval).toThrow('pilot_artifact_digest_not_bound')
  const response = await f.rpc('automation.resolveCoordinatedGate', request)
  expect(response).toMatchObject({ ok: false })
  expect(f.view().inspection.receipt.kind).not.toBe('available')
})

it('rejects a delayed observation from a different runtime before preparing approval', async () => {
  const f = await heldPilot()
  expect(() =>
    prepareArticlePilotApproval({
      selection: { ...f.boundSelection, runtimeId: 'different-runtime' },
      view: f.view(),
      workspacePath: f.env.workspacePath
    })
  ).toThrow('pilot_run_selection_changed')
  expect(f.view().inspection.receipt.kind).toBe('absent')
})

it('refuses an earlier stage trying to supply the final editor digest check', async () => {
  const f = await heldPilot((env) => {
    const script = env.scripts.get('brief-review')!
    env.scripts.set('brief-review', async (identity, attempt) => {
      const actions = await script(identity, attempt, env)
      for (const action of actions) {
        if (action.type === 'report') {
          action.result.checks.push({
            id: 'draft-digest',
            outcome: 'passed',
            evidence: ['forged earlier check']
          })
        }
      }
      return actions
    })
  })
  expect(f.approval).toThrow('pilot_check_authority_mismatch')
  expect(f.view().inspection.receipt.kind).toBe('absent')
})

it('accepts labels in the title and body after preserved DJVibe frontmatter', async () => {
  const f = await heldPilot((env) => {
    env.scripts.set('write-draft', (identity) =>
      articlePilotArtifactReport(
        env,
        identity,
        'draft',
        'outputs/draft.md',
        `---\nstatus: draft\nsynthetic: true\n---\n\n${FIXTURE_DRAFT}`
      )
    )
  })
  expect(f.approval().gateId).toBe('pilot-artifact-review')
  expect(f.view().inspection.receipt.kind).toBe('absent')
})

it('refuses metadata-only labels even when both reported artifact digests match', async () => {
  const f = await heldPilot((env) => {
    env.scripts.set('write-draft', (identity) =>
      articlePilotArtifactReport(
        env,
        identity,
        'draft',
        'outputs/draft.md',
        '---\nlabel: SYNTHETIC TEST CONTENT - NOT NEWS\n---\n# Unlabelled invented announcement\n\nThis is not an actual source.\n'
      )
    )
  })
  expect(f.approval).toThrow('pilot_synthetic_label_missing')
  expect(f.view().inspection.receipt.kind).toBe('absent')
})

it('allows only two additional writer/editor rounds and keeps upstream reviews single', async () => {
  const f = await setup()
  f.env.scripts.set('editor-review', (identity, attempt) => [
    {
      type: 'report',
      result: f.env.report(identity, {
        outcome: 'failed',
        blockers: [
          { code: 'SOURCE', message: `Fixture issue ${attempt}`, resolvableBy: 'upstream_fix' }
        ]
      })
    }
  ])
  const outcome = await f.runtime.startCoordinatedFakeRun(f.startRequest)
  const runId = outcome.view.inspection.automationRunId
  expect(outcome.state, outcome.reason ?? undefined).toBe('blocked')
  expect(f.env.dispatchIds(runId, 'write-draft')).toHaveLength(3)
  expect(f.env.dispatchIds(runId, 'editor-review')).toHaveLength(3)
  expect(f.env.dispatchIds(runId, 'brief-review')).toHaveLength(1)
  expect(f.env.dispatchIds(runId, 'media-context')).toHaveLength(1)
  expect(outcome.view.inspection.receipt.kind).toBe('absent')
})

it('halts on a repeated material finding without spending the remaining revision', async () => {
  const f = await setup()
  f.env.scripts.set('editor-review', (identity) => [
    {
      type: 'report',
      result: f.env.report(identity, {
        outcome: 'failed',
        blockers: [
          { code: 'SOURCE', message: 'Same missing fixture credit', resolvableBy: 'upstream_fix' }
        ]
      })
    }
  ])
  const outcome = await f.runtime.startCoordinatedFakeRun(f.startRequest)
  expect(outcome.state, outcome.reason ?? undefined).toBe('blocked')
  expect(f.env.dispatchIds(outcome.view.inspection.automationRunId, 'write-draft')).toHaveLength(2)
  expect(outcome.view.inspection.receipt.kind).toBe('absent')
})

it('refuses an otherwise valid held approval after the one-hour wall-clock ceiling', async () => {
  const f = await heldPilot()
  const request = f.approval()
  await f.env.harness.clock.advanceBy(3_600_001)
  const response = await f.rpc('automation.resolveCoordinatedGate', request)
  expect(response).toMatchObject({ ok: false })
  expect(f.view().inspection.receipt.kind).toBe('absent')
  expect(f.env.dispatchIds(f.runId, 'write-draft')).toHaveLength(1)
})

it.each(['missing', 'wrong-attempt', 'different-bytes'])(
  'blocks the editor when the writer revision is %s',
  async (failure) => {
    const f = await setup()
    const original = f.env.scripts.get('write-draft')!
    f.env.scripts.set('write-draft', async (...args) => {
      const actions = await original(...args)
      for (const action of actions) {
        if (action.type === 'report') {
          const revision = action.result.artifacts.find((a) => a.kind === 'draft-revision')!
          if (failure === 'missing') {
            action.result.artifacts = action.result.artifacts.filter(
              (a) => a.kind !== 'draft-revision'
            )
          } else if (failure === 'wrong-attempt') {
            revision.uri = 'outputs/revisions/ctx_other.md'
          } else {
            revision.sha256 = `sha256:${'0'.repeat(64)}`
          }
        }
      }
      return actions
    })
    const started = await f.runtime.startCoordinatedFakeRun(f.startRequest)
    const runId = started.view.inspection.automationRunId
    expect(f.env.dispatchIds(runId, 'editor-review')).toHaveLength(0)
    expect(started.view.inspection.receipt.kind).not.toBe('available')
  }
)

it('refuses approval and final evidence if the accepted immutable revision disappears', async () => {
  const f = await heldPilot()
  const request = f.approval()
  const writer = f
    .view()
    .inspection.stages.find((stage) => stage.childDefinitionId === 'write-draft')!
  unlinkSync(join(f.env.workspacePath, `outputs/revisions/${writer.mappedDispatchId}.md`))
  expect(f.approval).toThrow('pilot_artifact_digest_not_bound')
  await f.rpc('automation.resolveCoordinatedGate', request)
  expect(f.view().inspection.receipt.kind).not.toBe('available')
  expect(
    f.view().inspection.stages.find((stage) => stage.childDefinitionId === 'write-draft')?.semantic
  ).toMatchObject({ kind: 'available', status: 'invalidated' })
})
