import { describe, expect, it } from 'vitest'
import type { Automation } from './automations-types'
import { isValidArtifactUri } from './coordinated-automation-receipt-schemas'
import type {
  ReceiptValidationContext,
  SemanticCompletionReceipt
} from './coordinated-automation-receipt-types'
import { resolveAutomationSnapshot } from './coordinated-automation-snapshot'
import type {
  CoordinatedAutomationChildDefinition,
  CoordinatedAutomationDefinition,
  ResolvedAutomationRunSnapshot
} from './coordinated-automation-types'
import {
  parseExecutionAuthority,
  validateCoordinatedAutomationDefinition,
  validateReceiptAgainstSnapshot
} from './coordinated-automation-validation'
import {
  CoordinatedAutomationCreate,
  CoordinatedAutomationUpdateFields
} from './rpc-contract/coordinated-automation-params'

type TestAutomation = Automation & CoordinatedAutomationDefinition

const READER: CoordinatedAutomationChildDefinition = {
  id: 'child-1',
  role: 'w',
  name: 'W',
  promptSource: { kind: 'inline', text: 'x' },
  dependencies: [],
  mutationClass: 'read_only',
  launchConfig: {},
  enabled: true
}

function base(overrides: Partial<TestAutomation> = {}): TestAutomation {
  return {
    id: 'a1',
    kind: 'coordinated',
    definitionRevision: 1,
    name: 'n',
    prompt: 'p',
    precheck: null,
    agentId: 'claude',
    projectId: 'r',
    executionTargetType: 'local',
    executionTargetId: 'local-1',
    schedulerOwner: 'local_host_service',
    workspaceMode: 'existing',
    workspaceId: 'ws',
    baseBranch: 'main',
    reuseSession: false,
    timezone: 'UTC',
    rrule: 'FREQ=DAILY',
    dtstart: 1,
    enabled: true,
    nextRunAt: 2,
    missedRunPolicy: 'run_once_within_grace',
    missedRunGraceMinutes: 60,
    createdAt: 1,
    updatedAt: 1,
    outcomeContract: {
      humanStatement: 'h',
      acceptanceCriteria: [{ id: 'c1', description: 'd', required: true, kind: 'check' }],
      requiredApprovals: [{ id: 'ap1', role: 'editor', disallowAuthorApproval: true }],
      allowedFinalStates: ['completed']
    },
    children: [{ ...READER }],
    ...overrides
  }
}

const MAPPINGS = [{ childDefinitionId: 'child-1', taskId: 't1', dispatchId: 'd1' }]
const ATTEMPT = { taskId: 'tc', dispatchId: 'dc' }

function ctx(
  snap: ResolvedAutomationRunSnapshot,
  o: Partial<ReceiptValidationContext> = {}
): ReceiptValidationContext {
  return {
    trustedAuthorIdentity: 'bob',
    trustedHostId: snap.executionTarget.id,
    trustedExecutionAuthority: `${snap.executionTarget.type}:${snap.executionTarget.id}`,
    automationRunId: 'r',
    orchestrationRunId: 'o',
    activeAttempt: { ...ATTEMPT },
    trustedTaskMappings: MAPPINGS.map((m) => ({ ...m })),
    ...o
  }
}

function receipt(
  snap: ResolvedAutomationRunSnapshot,
  o: Partial<SemanticCompletionReceipt> = {},
  chain: Partial<SemanticCompletionReceipt['identityChain']> = {}
): SemanticCompletionReceipt {
  return {
    schemaVersion: 1,
    identityChain: {
      automationId: 'a1',
      definitionRevision: 1,
      automationRunId: 'r',
      orchestrationRunId: 'o',
      hostId: snap.executionTarget.id,
      targetExecutionAuthority: `${snap.executionTarget.type}:${snap.executionTarget.id}`,
      activeAttempt: { ...ATTEMPT },
      taskMappings: MAPPINGS.map((m) => ({ ...m })),
      ...chain
    },
    frozenConfigDigest: snap.canonicalDigest,
    finalState: 'completed',
    completedAt: 1,
    acceptanceResults: [
      { criterionId: 'c1', status: 'satisfied', evidence: ['e'], evaluatedAt: 1 }
    ],
    approvals: [{ approvalId: 'ap1', role: 'editor', approverIdentity: 'alice', approvedAt: 1 }],
    effectReceipts: [],
    unresolvedWarnings: [],
    ...o
  }
}

function errorsOf(r: { errors: string[] }, needle: string): boolean {
  return r.errors.some((e) => e.includes(needle))
}

const WRITER: CoordinatedAutomationChildDefinition = {
  ...READER,
  mutationClass: 'exclusive_writer',
  mutationLane: 'L',
  stageAcceptance: {
    requiredEffects: [
      { kind: 'git-push', namespace: 'repo', allowedStatuses: ['applied', 'verified'] }
    ]
  }
}

function publishingAutomation(): TestAutomation {
  return base({
    outcomeContract: {
      humanStatement: 'h',
      acceptanceCriteria: [
        {
          id: 'c1',
          description: 'd',
          required: true,
          kind: 'effect',
          targetChildId: 'child-1',
          namespace: 'site',
          details: { effectKind: 'deploy' }
        }
      ],
      requiredApprovals: [],
      allowedFinalStates: ['published_verified']
    },
    children: [{ ...WRITER }],
    publicationPolicy: {
      allowExternalMutation: true,
      requireHumanDecisionForProduction: true,
      allowedFinalStates: ['published_verified']
    }
  })
}

const VERIFIED_EFFECTS = [
  { kind: 'deploy', namespace: 'site', status: 'verified' as const, receipt: 'x', verifiedAt: 1 },
  { kind: 'git-push', namespace: 'repo', status: 'verified' as const, receipt: 'y', verifiedAt: 1 }
]
const DECISION = { approverIdentity: 'carol', role: 'release-manager', decidedAt: 1 }

describe('fail-closed receipt validation (final review F1-F7, F13)', () => {
  const snap = resolveAutomationSnapshot({ automation: base(), createdAt: 1 })

  it('positive: a fully matching receipt with trusted context is valid', () => {
    const res = validateReceiptAgainstSnapshot(receipt(snap), snap, ctx(snap))
    expect(res).toEqual({ valid: true, errors: [] })
  })

  it('F1: never falls back to a receipt-supplied author', () => {
    const forged = receipt(snap, {
      approvals: [
        {
          approvalId: 'ap1',
          role: 'editor',
          approverIdentity: 'alice',
          authorIdentity: 'mallory',
          approvedAt: 1
        }
      ]
    })
    const res = validateReceiptAgainstSnapshot(
      forged,
      snap,
      ctx(snap, { trustedAuthorIdentity: 'alice' })
    )
    expect(res.valid).toBe(false)
    expect(errorsOf(res, 'disallows author approval, but was approved by author "alice"')).toBe(
      true
    )
    expect(errorsOf(res, 'conflicts with the trusted author')).toBe(true)
    const blank = validateReceiptAgainstSnapshot(
      receipt(snap),
      snap,
      ctx(snap, { trustedAuthorIdentity: ' ' })
    )
    expect(errorsOf(blank, 'missing "trustedAuthorIdentity"')).toBe(true)
  })

  it('F2: rejects foreign run ids, a foreign active attempt, and mismatched trusted authority', () => {
    const res = validateReceiptAgainstSnapshot(
      receipt(snap, {}, { automationRunId: 'other-run', orchestrationRunId: 'other-orch' }),
      snap,
      ctx(snap, {
        trustedExecutionAuthority: 'ssh:elsewhere',
        activeAttempt: { taskId: 't9', dispatchId: 'd9' }
      })
    )
    expect(res.valid).toBe(false)
    expect(errorsOf(res, 'automationRunId "other-run" does not match trusted')).toBe(true)
    expect(errorsOf(res, 'orchestrationRunId "other-orch" does not match trusted')).toBe(true)
    expect(errorsOf(res, 'activeAttempt does not match trusted active attempt')).toBe(true)
    expect(errorsOf(res, 'Trusted execution authority "ssh:elsewhere" does not match')).toBe(true)
    const attempt = validateReceiptAgainstSnapshot(
      receipt(snap, {}, { activeAttempt: { taskId: 'tc', dispatchId: 'other' } }),
      snap,
      ctx(snap)
    )
    expect(errorsOf(attempt, 'activeAttempt does not match')).toBe(true)
  })

  it('F3: task mappings are mandatory and must exactly equal trusted mappings', () => {
    const omitted = receipt(snap)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: simulating an unparsed receipt without mappings
    delete (omitted.identityChain as { taskMappings?: unknown }).taskMappings
    expect(
      errorsOf(
        validateReceiptAgainstSnapshot(omitted, snap, ctx(snap)),
        'Receipt taskMappings are required'
      )
    ).toBe(true)
    const empty = validateReceiptAgainstSnapshot(
      receipt(snap, {}, { taskMappings: [] }),
      snap,
      ctx(snap)
    )
    expect(errorsOf(empty, 'missing taskMapping for enabled child "child-1"')).toBe(true)
    const wrongTask = validateReceiptAgainstSnapshot(
      receipt(
        snap,
        {},
        { taskMappings: [{ childDefinitionId: 'child-1', taskId: 't1', dispatchId: 'other' }] }
      ),
      snap,
      ctx(snap)
    )
    expect(errorsOf(wrongTask, 'does not exactly match the trusted mapping')).toBe(true)
    const noTrusted = validateReceiptAgainstSnapshot(
      receipt(snap),
      snap,
      ctx(snap, { trustedTaskMappings: [] })
    )
    expect(errorsOf(noTrusted, 'Trusted context is missing taskMapping')).toBe(true)
  })

  it('F4: ssh/local authority uses exact parsed equality, not substrings or bare forms', () => {
    const ss = resolveAutomationSnapshot({
      automation: base({ executionTargetType: 'ssh', executionTargetId: 'prod' }),
      createdAt: 1
    })
    for (const auth of [
      'ssh:not-prod-evil',
      'ssh:prod-evil',
      'ssh:prod ',
      'local:prod',
      'prod',
      'ssh:'
    ]) {
      const res = validateReceiptAgainstSnapshot(
        receipt(ss, {}, { targetExecutionAuthority: auth }),
        ss,
        ctx(ss)
      )
      expect(res.valid, auth).toBe(false)
      expect(errorsOf(res, 'targetExecutionAuthority')).toBe(true)
    }
    expect(validateReceiptAgainstSnapshot(receipt(ss), ss, ctx(ss)).valid).toBe(true)
    for (const auth of ['local', 'local-1', 'local:local-1x']) {
      const res = validateReceiptAgainstSnapshot(
        receipt(snap, {}, { targetExecutionAuthority: auth }),
        snap,
        ctx(snap)
      )
      expect(res.valid, auth).toBe(false)
    }
    expect(parseExecutionAuthority('ssh:prod')).toEqual({ type: 'ssh', id: 'prod' })
    expect(parseExecutionAuthority('ftp:prod')).toBeNull()
  })

  it('F5: the trusted author cannot waive and waiver authority comes from trusted context', () => {
    const waived = (authorizedBy: string) =>
      receipt(snap, {
        acceptanceResults: [
          {
            criterionId: 'c1',
            status: 'waived',
            evidence: ['e'],
            evaluatedAt: 1,
            waiver: { authorizedBy }
          }
        ]
      })
    const policy = {
      allowedRoles: ['qa-lead'],
      authorities: [
        { identity: 'bob', role: 'qa-lead' },
        { identity: 'dave', role: 'qa-lead' },
        { identity: 'eve', role: 'intern' }
      ]
    }
    const byAuthor = validateReceiptAgainstSnapshot(
      waived('bob'),
      snap,
      ctx(snap, { waiverPolicy: policy })
    )
    expect(errorsOf(byAuthor, 'cannot be waived by the trusted author "bob"')).toBe(true)
    const noPolicy = validateReceiptAgainstSnapshot(waived('dave'), snap, ctx(snap))
    expect(errorsOf(noPolicy, 'is not granted by trusted context')).toBe(true)
    const badRole = validateReceiptAgainstSnapshot(
      waived('eve'),
      snap,
      ctx(snap, { waiverPolicy: policy })
    )
    expect(errorsOf(badRole, 'not an allowed waiver role')).toBe(true)
    const ok = validateReceiptAgainstSnapshot(
      waived('dave'),
      snap,
      ctx(snap, { waiverPolicy: policy })
    )
    expect(ok).toEqual({ valid: true, errors: [] })
  })

  it('F6: published_verified requires verified matching effects and a trusted distinct human decision', () => {
    const ps = resolveAutomationSnapshot({ automation: publishingAutomation(), createdAt: 1 })
    const pv = (o: Partial<SemanticCompletionReceipt>) =>
      receipt(ps, {
        finalState: 'published_verified',
        approvals: [],
        acceptanceResults: [
          { criterionId: 'c1', status: 'satisfied', evidence: ['e'], evaluatedAt: 1 }
        ],
        ...o
      })

    const none = validateReceiptAgainstSnapshot(pv({ effectReceipts: [] }), ps, ctx(ps))
    expect(none.valid).toBe(false)
    expect(errorsOf(none, 'Required effect "deploy"')).toBe(true)
    expect(errorsOf(none, 'requires at least one verified effect receipt')).toBe(true)
    expect(errorsOf(none, 'requires a trusted human production decision')).toBe(true)

    const unrelated = validateReceiptAgainstSnapshot(
      pv({
        effectReceipts: [{ kind: 'unrelated', status: 'applied', receipt: 'x', verifiedAt: 1 }]
      }),
      ps,
      ctx(ps, { productionDecision: DECISION })
    )
    expect(errorsOf(unrelated, 'does not match any declared effect')).toBe(true)
    expect(errorsOf(unrelated, 'external effects must be verified')).toBe(true)

    const appliedOnly = validateReceiptAgainstSnapshot(
      pv({ effectReceipts: VERIFIED_EFFECTS.map((e) => ({ ...e, status: 'applied' as const })) }),
      ps,
      ctx(ps, { productionDecision: DECISION })
    )
    expect(errorsOf(appliedOnly, 'has no verified effect receipt')).toBe(true)

    const wrongNamespace = validateReceiptAgainstSnapshot(
      pv({ effectReceipts: [{ ...VERIFIED_EFFECTS[0], namespace: 'other' }, VERIFIED_EFFECTS[1]] }),
      ps,
      ctx(ps, { productionDecision: DECISION })
    )
    expect(errorsOf(wrongNamespace, 'Required effect "deploy" (namespace "site")')).toBe(true)

    const authorDecision = validateReceiptAgainstSnapshot(
      pv({ effectReceipts: VERIFIED_EFFECTS }),
      ps,
      ctx(ps, { productionDecision: { ...DECISION, approverIdentity: 'bob' } })
    )
    expect(errorsOf(authorDecision, 'distinct from the author')).toBe(true)

    const ok = validateReceiptAgainstSnapshot(
      pv({ effectReceipts: VERIFIED_EFFECTS }),
      ps,
      ctx(ps, { productionDecision: DECISION })
    )
    expect(ok).toEqual({ valid: true, errors: [] })
  })

  it('F6c: any effect receipt is rejected when external mutation is not allowed', () => {
    const res = validateReceiptAgainstSnapshot(
      receipt(snap, {
        effectReceipts: [{ kind: 'k', status: 'verified', receipt: 'x', verifiedAt: 1 }]
      }),
      snap,
      ctx(snap)
    )
    expect(errorsOf(res, 'allowExternalMutation is false')).toBe(true)
  })

  it('F7: unknown criterion and approval ids are rejected', () => {
    const res = validateReceiptAgainstSnapshot(
      receipt(snap, {
        acceptanceResults: [
          { criterionId: 'c1', status: 'satisfied', evidence: ['e'], evaluatedAt: 1 },
          { criterionId: 'zzz', status: 'failed', evidence: [], evaluatedAt: 1 }
        ],
        approvals: [
          { approvalId: 'ap1', role: 'editor', approverIdentity: 'alice', approvedAt: 1 },
          { approvalId: 'ghost', role: 'editor', approverIdentity: 'zed', approvedAt: 1 }
        ]
      }),
      snap,
      ctx(snap)
    )
    expect(errorsOf(res, 'unknown criterion "zzz"')).toBe(true)
    expect(errorsOf(res, 'unknown approval requirement "ghost"')).toBe(true)
  })
})

describe('definition and RPC hardening (M1, F13, URI, parsed snapshot)', () => {
  it('M1: rejects duplicate criterion and approval ids and effect criteria without effectKind', () => {
    const a = base()
    a.outcomeContract.acceptanceCriteria.push({
      id: 'c1',
      description: 'e',
      required: false,
      kind: 'check'
    })
    a.outcomeContract.requiredApprovals.push({ id: 'ap1', role: 'legal' })
    const res = validateCoordinatedAutomationDefinition(a)
    expect(
      res.errors.some((e) => e.message.includes('Duplicate acceptance criterion ID "c1"'))
    ).toBe(true)
    expect(res.errors.some((e) => e.message.includes('Duplicate required approval ID "ap1"'))).toBe(
      true
    )
    expect(() => resolveAutomationSnapshot({ automation: a, createdAt: 1 })).toThrow(/Duplicate/)

    const p = publishingAutomation()
    p.outcomeContract.acceptanceCriteria[0].details = {}
    expect(
      validateCoordinatedAutomationDefinition(p).errors.some((e) =>
        e.message.includes('details.effectKind')
      )
    ).toBe(true)
  })

  it('F13: update fields enforce child graph and contract id uniqueness; valid updates pass', () => {
    expect(
      CoordinatedAutomationUpdateFields.safeParse({ children: [READER, READER] }).success
    ).toBe(false)
    const missingDep = { ...READER, id: 'child-2', dependencies: [{ childId: 'nope' }] }
    expect(
      CoordinatedAutomationUpdateFields.safeParse({ children: [READER, missingDep] }).success
    ).toBe(false)
    const cyc1 = { ...READER, id: 'x1', dependencies: [{ childId: 'x2' }] }
    const cyc2 = { ...READER, id: 'x2', dependencies: [{ childId: 'x1' }] }
    expect(CoordinatedAutomationUpdateFields.safeParse({ children: [cyc1, cyc2] }).success).toBe(
      false
    )
    const dupContract = {
      ...base().outcomeContract,
      requiredApprovals: [
        { id: 'ap1', role: 'a' },
        { id: 'ap1', role: 'b' }
      ]
    }
    expect(
      CoordinatedAutomationUpdateFields.safeParse({ outcomeContract: dupContract }).success
    ).toBe(false)
    const dep = { ...READER, id: 'child-2', dependencies: [{ childId: 'child-1' }] }
    expect(CoordinatedAutomationUpdateFields.safeParse({ children: [READER, dep] }).success).toBe(
      true
    )
    expect(
      CoordinatedAutomationUpdateFields.safeParse({ outcomeContract: base().outcomeContract })
        .success
    ).toBe(true)
    const create = {
      name: 'n',
      prompt: 'p',
      agentId: 'claude',
      rrule: 'FREQ=DAILY',
      dtstart: 1,
      kind: 'coordinated',
      outcomeContract: dupContract,
      children: [READER]
    }
    expect(CoordinatedAutomationCreate.safeParse(create).success).toBe(false)
  })

  it('rejects all-dot URI segments and keeps safe dotted names', () => {
    for (const uri of ['...', 'a/.../b', '....', 'artifact://.../x', 'a/./b', '..']) {
      expect(isValidArtifactUri(uri), uri).toBe(false)
    }
    for (const uri of ['notes..v2.md', '.hidden', 'reports/x.md', 'artifact://a/b.md']) {
      expect(isValidArtifactUri(uri), uri).toBe(true)
    }
  })

  it('builds the snapshot from schema-parsed output rather than the raw payload', () => {
    const a = base()
    a.outcomeContract.humanStatement = '  padded statement  '
    a.outcomeContract.acceptanceCriteria[0].description = '  padded  '
    a.children[0].name = '  Padded Name  '
    const snap = resolveAutomationSnapshot({ automation: a, createdAt: 1 })
    expect(snap.outcomeContract.humanStatement).toBe('padded statement')
    expect(snap.outcomeContract.acceptanceCriteria[0].description).toBe('padded')
    expect(snap.resolvedChildren[0].name).toBe('Padded Name')
    const trimmed = base()
    trimmed.outcomeContract.humanStatement = 'padded statement'
    trimmed.outcomeContract.acceptanceCriteria[0].description = 'padded'
    trimmed.children[0].name = 'Padded Name'
    expect(resolveAutomationSnapshot({ automation: trimmed, createdAt: 1 }).canonicalDigest).toBe(
      snap.canonicalDigest
    )
  })
})
