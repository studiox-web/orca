import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'
import { z } from 'zod'
import { CoordinatedAutomationCreate } from '../../../src/shared/rpc-contract/coordinated-automation-params'
import { CoordinatedAutomationDefinitionSchema } from '../../../src/shared/coordinated-automation-schemas'
import { validateCoordinatedAutomationDefinition } from '../../../src/shared/coordinated-automation-validation'
import type { CoordinatedAutomationDefinition } from '../../../src/shared/coordinated-automation-types'
import { normalizeWorkspaceSessionKeyToWorkspaceId } from '../../../src/shared/workspace-scope'

export const ARTICLE_ID = 'djvibe-shadow-synthetic-001'
export const ARTICLE_LABEL = 'SYNTHETIC TEST CONTENT - NOT NEWS'
export const ARTICLE_REVIEW_GATE = 'pilot-artifact-review'
export const ARTICLE_STAGES = [
  'brief-review',
  'media-context',
  'write-draft',
  'editor-review'
] as const

const InputManifest = z.object({
  schemaVersion: z.literal(1),
  fixtureId: z.literal(ARTICLE_ID),
  synthetic: z.literal(true),
  entries: z
    .array(
      z.object({
        path: z.string().min(1),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        bytes: z.number().int().nonnegative()
      })
    )
    .min(1)
})

export function loadArticlePilotInputs(root: string) {
  const canonicalRoot = realpathSync(root)
  const manifestBytes = readFileSync(join(canonicalRoot, 'input-manifest.json'))
  const manifest = InputManifest.parse(JSON.parse(manifestBytes.toString('utf8')))
  const files = new Map<string, string>()
  for (const entry of manifest.entries) {
    const path = realpathSync(join(canonicalRoot, entry.path))
    const child = relative(canonicalRoot, path)
    if (
      !child ||
      isAbsolute(child) ||
      child === '..' ||
      child.startsWith(`..${sep}`) ||
      files.has(entry.path)
    ) {
      throw new Error(`pilot_input_path_invalid:${entry.path}`)
    }
    const bytes = readFileSync(path)
    if (
      bytes.length !== entry.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== entry.sha256
    ) {
      throw new Error(`pilot_input_digest_mismatch:${entry.path}`)
    }
    files.set(entry.path, bytes.toString('utf8'))
  }
  return {
    inputManifestDigest: `sha256:${createHash('sha256').update(manifestBytes).digest('hex')}`,
    read(path: string) {
      const text = files.get(path)
      if (text === undefined) {
        throw new Error(`pilot_input_missing:${path}`)
      }
      return text
    }
  }
}

const roles = [
  {
    id: 'brief-review',
    goal: 'content-editor',
    name: 'Brief review',
    scope:
      'Review fixture completeness and fixture-local duplication. Write outputs/brief-review.json.',
    artifact: 'brief-review',
    uri: 'outputs/brief-review.json',
    checks: ['fixture-sources', 'fixture-duplicate']
  },
  {
    id: 'media-context',
    goal: 'content-media',
    name: 'Media-context review',
    scope:
      'Review the frozen media context. Write outputs/media-context-review.json. No imports, covers, embeds or playback claims.',
    artifact: 'media-context',
    uri: 'outputs/media-context-review.json',
    checks: ['fixture-media-limits']
  },
  {
    id: 'write-draft',
    goal: 'content-writer',
    name: 'Writer',
    scope:
      'Write or revise outputs/draft.md for this article only. Read the latest admitted editor findings on each revision. Preserve revision copies.',
    artifact: 'draft',
    uri: 'outputs/draft.md',
    checks: ['synthetic-label', 'source-traceability']
  },
  {
    id: 'editor-review',
    goal: 'content-editor',
    name: 'Independent editorial reviewer',
    scope:
      'Independently review the exact writer draft; write outputs/editor-review.json using the pilot scope schema. Report concrete findings or approval with the reviewed digest.',
    artifact: 'editor-review',
    uri: 'outputs/editor-review.json',
    checks: ['independent-review', 'draft-digest', 'voice-and-credits']
  }
] as const

export function articlePilotCheckOwner(checkId: string): string | null {
  return roles.find((role) => role.checks.some((id) => id === checkId))?.id ?? null
}

export type ArticlePilotSelection = {
  workspaceId: string
  promptAuthority: string
  maxEstimatedCostUsd: number
  models: Record<(typeof ARTICLE_STAGES)[number], { model: string; reasoningEffort: string }>
}

/** Builds native definition data only; never creates a profile, run, provider or schedule. */
export function buildArticlePilotDefinition(
  inputs: ReturnType<typeof loadArticlePilotInputs>,
  selection: ArticlePilotSelection
): CoordinatedAutomationDefinition {
  if (!selection.workspaceId.trim()) {
    throw new Error('pilot_workspace_required')
  }
  if (!selection.promptAuthority.trim()) {
    throw new Error('pilot_prompt_authority_required')
  }
  if (!Number.isFinite(selection.maxEstimatedCostUsd) || selection.maxEstimatedCostUsd <= 0) {
    throw new Error('pilot_estimated_budget_required')
  }
  for (const role of roles) {
    if (
      !selection.models[role.id]?.model.trim() ||
      !selection.models[role.id]?.reasoningEffort.trim()
    ) {
      throw new Error(`pilot_explicit_model_required:${role.id}`)
    }
  }
  const definition = CoordinatedAutomationDefinitionSchema.parse({
    kind: 'coordinated',
    definitionRevision: 1,
    outcomeContract: {
      humanStatement: `One ${ARTICLE_ID} test draft, independently reviewed against its exact digest, ready for human inspection only.`,
      acceptanceCriteria: roles.flatMap((role) =>
        role.checks.map((id) => ({
          id,
          description: `${role.name}: ${id}`,
          required: true,
          kind: 'check',
          targetChildId: role.id
        }))
      ),
      requiredApprovals: [],
      allowedFinalStates: ['ready_for_review', 'failed', 'blocked', 'outcome_uncertain']
    },
    children: roles.map((role, index) => ({
      id: role.id,
      role: role.id,
      name: role.name,
      enabled: true,
      description: `${ARTICLE_ID}; ${role.scope}`,
      promptSource: {
        kind: 'source_reference',
        path: `inputs/prompts/${role.id}.md`,
        authority: selection.promptAuthority,
        digest: `sha256:${createHash('sha256')
          .update(inputs.read(`prompts/${role.id}.md`))
          .digest('hex')}`
      },
      dependencies: index === 0 ? [] : [{ childId: roles[index - 1].id, condition: 'accepted' }],
      mutationClass: 'exclusive_writer',
      mutationLane: role.id === 'write-draft' ? `${ARTICLE_ID}:draft` : `${ARTICLE_ID}:${role.id}`,
      launchConfig: {
        agentId: 'codex',
        ...selection.models[role.id],
        workspaceId: selection.workspaceId,
        surface: 'terminal',
        extraAgentArgs: '',
        reuseSession: false,
        workspaceMode: 'existing',
        setupDecision: 'skip',
        timeoutSeconds: 600,
        maxRetries: 0,
        maxReviewIterations: role.id === 'write-draft' ? 2 : 0
      },
      stageAcceptance: {
        requiredArtifacts: [
          { kind: role.artifact, pathPattern: role.uri, required: true },
          ...(role.id === 'write-draft'
            ? [
                {
                  kind: 'draft-revision',
                  pathPattern: 'outputs/revisions/{dispatchId}.md',
                  sameDigestAs: 'draft',
                  required: true
                }
              ]
            : []),
          ...(role.id === 'editor-review'
            ? [{ kind: 'reviewed-draft', pathPattern: 'outputs/draft.md', required: true }]
            : [])
        ],
        requiredChecks: role.checks.map((id) => ({ id, required: true })),
        requiredApprovals:
          role.id === 'editor-review'
            ? [
                {
                  id: ARTICLE_REVIEW_GATE,
                  role: 'pilot-operator',
                  disallowAuthorApproval: true,
                  required: true
                }
              ]
            : []
      }
    })),
    globalCeilings: {
      maxConcurrency: 1,
      maxActiveFixersPerArtifact: 1,
      maxReviewIterations: 2,
      maxWallClockSeconds: 3600,
      maxDispatchStartFailures: 1,
      maxEstimatedCostUsd: selection.maxEstimatedCostUsd
    },
    publicationPolicy: {
      allowExternalMutation: false,
      allowedFinalStates: ['ready_for_review', 'failed', 'blocked', 'outcome_uncertain'],
      requireHumanDecisionForProduction: true
    },
    retentionPolicy: {
      preserveCompletionReceipt: true,
      preserveSnapshot: true,
      preserveMappings: true,
      artifactRetentionDays: 30,
      defaultRetentionClass: 'audit'
    }
  })
  const validation = validateCoordinatedAutomationDefinition(definition)
  if (!validation.valid) {
    throw new Error(validation.errors.map((error) => error.message).join('; '))
  }
  return definition
}

export function buildArticlePilotCreateRequest(
  inputs: ReturnType<typeof loadArticlePilotInputs>,
  selection: ArticlePilotSelection,
  creationKey: string
) {
  if (!creationKey.trim()) {
    throw new Error('pilot_creation_key_required')
  }
  const { definitionRevision: _revision, ...definition } = buildArticlePilotDefinition(
    inputs,
    selection
  )
  return CoordinatedAutomationCreate.parse({
    ...definition,
    creationKey,
    name: 'DJVibe synthetic article shadow pilot',
    prompt: `Coordinate only ${ARTICLE_ID}. Inputs ${inputs.inputManifestDigest}. No publication.`,
    agentId: 'codex',
    workspace: `id:${normalizeWorkspaceSessionKeyToWorkspaceId(selection.workspaceId)}`,
    workspaceMode: 'existing',
    setupDecision: 'skip',
    reuseSession: false,
    extraAgentArgs: '',
    timezone: 'America/Vancouver',
    destination: { selector: { kind: 'self' } },
    triggerPolicy: 'manual_only',
    enabled: false
  })
}
