import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { currentWorkspaceArtifactDigest } from '../../../src/main/automations/coordinated-automation-artifact-validation'
import type { CoordinatedRunView } from '../../../src/shared/coordinated-automation-run-view'
import { ResolveCoordinatedGate } from '../../../src/shared/rpc-contract/coordinated-automation-run-params'
import {
  ARTICLE_ID,
  ARTICLE_LABEL,
  ARTICLE_REVIEW_GATE,
  articlePilotCheckOwner
} from './coordinated-article-pilot-package'

const EditorReview = z.strictObject({
  schemaVersion: z.literal(1),
  synthetic: z.literal(true),
  articleIdentity: z.literal(ARTICLE_ID),
  draftSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  writerTaskId: z.string().min(1),
  writerDispatchId: z.string().min(1),
  reviewerTaskId: z.string().min(1),
  reviewerDispatchId: z.string().min(1),
  decision: z.enum(['approved', 'revision_requested']),
  findings: z.array(z.string())
})

export type ArticlePilotRunSelection = {
  runtimeId: string
  automationId: string
  automationRunId: string
  orchestrationRunId: string
  definitionRevision: number
  canonicalDigest: string
  targetExecutionAuthority: string
}

/** Returns a reviewable native gate payload; it never approves a gate or mints a receipt. */
export function prepareArticlePilotApproval(input: {
  selection: ArticlePilotRunSelection
  view: CoordinatedRunView
  workspacePath: string
}) {
  const { selection, view, workspacePath } = input
  const run = view.inspection
  if (
    view.runtimeId !== selection.runtimeId ||
    run.automationId !== selection.automationId ||
    run.automationRunId !== selection.automationRunId ||
    run.orchestrationRunId !== selection.orchestrationRunId ||
    run.definitionRevision !== selection.definitionRevision ||
    run.canonicalDigest !== selection.canonicalDigest ||
    run.targetExecutionAuthority !== selection.targetExecutionAuthority
  ) {
    throw new Error('pilot_run_selection_changed')
  }
  for (const stage of run.stages) {
    const evidence = stage.pendingApproval?.report ?? stage.evidence
    if (
      evidence.kind !== 'available' ||
      new Set(evidence.checks.map((check) => check.id)).size !== evidence.checks.length ||
      evidence.checks.some((check) => articlePilotCheckOwner(check.id) !== stage.childDefinitionId)
    ) {
      throw new Error('pilot_check_authority_mismatch')
    }
  }
  const writer = run.stages.find((stage) => stage.childDefinitionId === 'write-draft')
  const editor = run.stages.find((stage) => stage.childDefinitionId === 'editor-review')
  const held = editor?.pendingApproval
  if (
    !writer?.taskId ||
    writer.evidence.kind !== 'available' ||
    writer.evidence.disposition !== 'accepted' ||
    !editor?.taskId ||
    !held ||
    held.report.kind !== 'available' ||
    held.report.outcome !== 'succeeded' ||
    !held.gateIds.includes(ARTICLE_REVIEW_GATE) ||
    !editor.gateResolutionEligibility.canResolve ||
    !view.actions.humanResolution.available
  ) {
    throw new Error('pilot_independent_review_not_held')
  }
  if (writer.taskId === editor.taskId || writer.evidence.dispatchId === held.dispatchId) {
    throw new Error('pilot_self_review')
  }
  const draftSha256 = currentWorkspaceArtifactDigest('outputs/draft.md', workspacePath)
  const revisionUri = `outputs/revisions/${writer.evidence.dispatchId}.md`
  const revisionSha256 = currentWorkspaceArtifactDigest(revisionUri, workspacePath)
  const reviewSha256 = currentWorkspaceArtifactDigest('outputs/editor-review.json', workspacePath)
  if (
    !draftSha256 ||
    !reviewSha256 ||
    revisionSha256 !== draftSha256 ||
    !writer.evidence.artifacts.some(
      (artifact) =>
        artifact.kind === 'draft-revision' &&
        artifact.uri === revisionUri &&
        artifact.sha256 === draftSha256
    ) ||
    !writer.evidence.artifacts.some(
      (artifact) =>
        artifact.kind === 'draft' &&
        artifact.uri === 'outputs/draft.md' &&
        artifact.sha256 === draftSha256
    ) ||
    !held.report.artifacts.some(
      (artifact) =>
        artifact.kind === 'reviewed-draft' &&
        artifact.uri === 'outputs/draft.md' &&
        artifact.sha256 === draftSha256
    ) ||
    !held.report.artifacts.some(
      (artifact) =>
        artifact.kind === 'editor-review' &&
        artifact.uri === 'outputs/editor-review.json' &&
        artifact.sha256 === reviewSha256
    ) ||
    !held.report.checks.some(
      (check) =>
        check.id === 'draft-digest' &&
        check.outcome === 'passed' &&
        check.evidence?.includes(draftSha256)
    )
  ) {
    throw new Error('pilot_artifact_digest_not_bound')
  }
  const review = EditorReview.parse(
    JSON.parse(readFileSync(join(workspacePath, 'outputs/editor-review.json'), 'utf8'))
  )
  const draft = readFileSync(join(workspacePath, 'outputs/draft.md'), 'utf8')
  if (
    review.decision !== 'approved' ||
    review.findings.length ||
    review.draftSha256 !== draftSha256 ||
    review.writerTaskId !== writer.taskId ||
    review.writerDispatchId !== writer.evidence.dispatchId ||
    review.reviewerTaskId !== editor.taskId ||
    review.reviewerDispatchId !== held.dispatchId
  ) {
    throw new Error('pilot_editor_review_identity_or_decision_mismatch')
  }
  const body = draft.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
  const lines = body.split('\n').filter((line) => line.trim())
  if (!lines[0]?.includes(ARTICLE_LABEL) || !lines[1]?.includes(ARTICLE_LABEL)) {
    throw new Error('pilot_synthetic_label_missing')
  }
  return ResolveCoordinatedGate.parse({
    runtimeId: selection.runtimeId,
    automationId: run.automationId,
    automationRunId: run.automationRunId,
    orchestrationRunId: run.orchestrationRunId,
    expectedOwner: { selector: { kind: 'self' } },
    definitionRevision: run.definitionRevision,
    targetExecutionAuthority: run.targetExecutionAuthority,
    gateId: ARTICLE_REVIEW_GATE,
    gateScope: 'stage',
    decision: 'approve',
    childDefinitionId: editor.childDefinitionId,
    taskId: editor.taskId,
    dispatchId: held.dispatchId,
    expectedReportDigest: held.reportDigest,
    note: `${ARTICLE_ID}; independently inspected ${draftSha256}; synthetic mechanism test only.`
  })
}
