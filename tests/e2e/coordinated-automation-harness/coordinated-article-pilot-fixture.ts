import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import type { CoordinatedAutomationCreateInput } from '../../../src/shared/automations-types'
import type { CoordinatedWorkerIdentity } from '../../../src/main/automations/coordinated-automation-adapter'
import { currentWorkspaceArtifactDigest } from '../../../src/main/automations/coordinated-automation-artifact-validation'
import type { ScriptedWorkerAction } from './isolated-adapters'
import type { ResolvePromptFunction } from '../../../src/shared/coordinated-automation-snapshot'
import type { RecoveryEnv } from './coordinated-automation-recovery-env'
import {
  ARTICLE_ID,
  ARTICLE_LABEL,
  buildArticlePilotDefinition,
  loadArticlePilotInputs
} from './coordinated-article-pilot-package'

export const PILOT_INPUT_ROOT = resolve('docs/pilots/djvibe-article-shadow/inputs-v1')
export const FIXTURE_DRAFT = `# ${ARTICLE_LABEL}\n\n${ARTICLE_LABEL}\n\nLoop Lantern is an invented duo.\n`

export function articlePilotFixtureDefinition(): CoordinatedAutomationCreateInput {
  const definition = buildArticlePilotDefinition(loadArticlePilotInputs(PILOT_INPUT_ROOT), {
    workspaceId: 'folder:repo-folder',
    promptAuthority: 'fixture:article-pilot',
    maxEstimatedCostUsd: 10,
    models: {
      'brief-review': { model: 'fixture-model-not-a-provider', reasoningEffort: 'medium' },
      'media-context': { model: 'fixture-model-not-a-provider', reasoningEffort: 'medium' },
      'write-draft': { model: 'fixture-model-not-a-provider', reasoningEffort: 'medium' },
      'editor-review': { model: 'fixture-model-not-a-provider', reasoningEffort: 'medium' }
    }
  })
  const { definitionRevision: _revision, ...fields } = definition
  return {
    ...fields,
    name: 'Synthetic article pilot',
    prompt: 'Coordinate one synthetic test article.',
    timezone: 'UTC',
    agentId: 'codex',
    projectId: 'repo-folder',
    workspaceMode: 'existing',
    workspaceId: 'folder:repo-folder',
    setupDecision: 'skip',
    triggerPolicy: 'manual_only',
    enabled: false
  }
}

export const articlePilotFixturePromptResolver: ResolvePromptFunction = (source) => {
  if (source.authority !== 'fixture:article-pilot' || !source.path.startsWith('inputs/prompts/')) {
    throw new Error('fixture_prompt_authority_mismatch')
  }
  return {
    text: loadArticlePilotInputs(PILOT_INPUT_ROOT).read(source.path.slice('inputs/'.length))
  }
}

/** Scripted fake workers exercise native admission; these are never provider evidence. */
export function scriptArticlePilotFixture(env: RecoveryEnv) {
  const definition = articlePilotFixtureDefinition()
  for (const child of definition.children ?? []) {
    env.scripts.set(child.id, (identity) => {
      let content = JSON.stringify({
        synthetic: true,
        articleIdentity: ARTICLE_ID,
        stage: child.id
      })
      const requirement = child.stageAcceptance!.requiredArtifacts![0]
      if (child.id === 'write-draft') {
        content = FIXTURE_DRAFT
      }
      if (child.id === 'editor-review') {
        const writer = env
          .run(identity.automationRunId)
          .childMappings!.find((mapping) => mapping.childDefinitionId === 'write-draft')!
        content = JSON.stringify({
          schemaVersion: 1,
          synthetic: true,
          articleIdentity: ARTICLE_ID,
          draftSha256: currentWorkspaceArtifactDigest('outputs/draft.md', env.workspacePath),
          writerTaskId: writer.taskId,
          writerDispatchId: writer.dispatchId,
          reviewerTaskId: identity.taskId,
          reviewerDispatchId: identity.dispatchId,
          decision: 'approved',
          findings: []
        })
      }
      return articlePilotArtifactReport(
        env,
        identity,
        requirement.kind,
        requirement.pathPattern!,
        content
      )
    })
  }
}

export function articlePilotArtifactReport(
  env: RecoveryEnv,
  identity: CoordinatedWorkerIdentity,
  kind: string,
  uri: string,
  content: string
): ScriptedWorkerAction[] {
  const child = env
    .run(identity.automationRunId)
    .resolvedSnapshot!.resolvedChildren.find(
      (child) => child.childDefinitionId === identity.childDefinitionId
    )!
  const draftSha256 = currentWorkspaceArtifactDigest('outputs/draft.md', env.workspacePath)
  const artifacts = [
    { kind, uri, sha256: `sha256:${createHash('sha256').update(content).digest('hex')}` }
  ]
  const writes: ScriptedWorkerAction[] = [{ type: 'write-artifact', uri, content }]
  if (identity.childDefinitionId === 'write-draft') {
    const revisionUri = `outputs/revisions/${identity.dispatchId}.md`
    artifacts.push({ kind: 'draft-revision', uri: revisionUri, sha256: artifacts[0].sha256 })
    writes.push({ type: 'write-artifact', uri: revisionUri, content })
  }
  if (identity.childDefinitionId === 'editor-review' && draftSha256) {
    artifacts.push({ kind: 'reviewed-draft', uri: 'outputs/draft.md', sha256: draftSha256 })
  }
  return [
    ...writes,
    {
      type: 'report',
      result: env.report(identity, {
        artifacts,
        checks: (child.stageAcceptance?.requiredChecks ?? []).map((check) => ({
          id: check.id,
          outcome: 'passed',
          evidence:
            check.id === 'draft-digest' && draftSha256
              ? [draftSha256]
              : ['Scripted fixture evidence only']
        }))
      })
    }
  ]
}
