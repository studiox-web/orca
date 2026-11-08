import { isSameStableAutomationHost } from './automation-owner-key'
import { encodeUnifiedAutomationKey } from './unified-automation-identity'
import type {
  UnifiedAutomationIdentity,
  UnifiedAutomationRow,
  UnifiedSourceRef
} from './unified-automation-types'

export type UnifiedDetailRow = Pick<
  UnifiedAutomationRow,
  'key' | 'identity' | 'sourceRefs' | 'scriptEvidence'
>

export type UnifiedDetailSelection = {
  key: string
  identity: UnifiedAutomationIdentity
  sourceRefs: readonly UnifiedSourceRef[]
}

export type UnifiedDetailTarget =
  | {
      kind: 'goal'
      identity: Extract<UnifiedAutomationIdentity, { kind: 'goal' }>
      projectKey: string
      goal: string
      boardRevision: string | null
      sourceRef: UnifiedSourceRef
    }
  | {
      kind: 'automation'
      identity: Extract<UnifiedAutomationIdentity, { kind: 'automation' }>
      ownerKey: string | null
      revision: string | null
      sourceRef: UnifiedSourceRef
    }
  | {
      kind: 'script'
      identity: Extract<UnifiedAutomationIdentity, { kind: 'script' }>
      bindingAutomationId: string | null
      bindingRef: UnifiedSourceRef | null
      cronRef: UnifiedSourceRef | null
      evidence: UnifiedAutomationRow['scriptEvidence']
    }
  | {
      kind: 'external'
      identity: Extract<UnifiedAutomationIdentity, { kind: 'external' }>
      sourceRef: UnifiedSourceRef
    }

export type UnifiedDetailResolution =
  | { status: 'resolved'; target: UnifiedDetailTarget }
  | {
      status: 'stale'
      key: string
      identity: UnifiedAutomationIdentity
      sourceRefs: readonly UnifiedSourceRef[]
    }
  | {
      status: 'missing-source'
      key: string
      identity: UnifiedAutomationIdentity
      sourceRefs: readonly UnifiedSourceRef[]
      requiredSourceKinds: readonly UnifiedSourceRef['kind'][]
    }

function sameIdentity(left: UnifiedAutomationIdentity, right: UnifiedAutomationIdentity): boolean {
  return encodeUnifiedAutomationKey(left) === encodeUnifiedAutomationKey(right)
}

function exactSourceRefs(
  row: UnifiedDetailRow,
  kinds: readonly UnifiedSourceRef['kind'][]
): UnifiedSourceRef[] {
  return row.sourceRefs.filter(
    (sourceRef) =>
      kinds.includes(sourceRef.kind) &&
      isSameStableAutomationHost(sourceRef.authority, row.identity.authority)
  )
}

function missingSource(
  row: UnifiedDetailRow,
  requiredSourceKinds: readonly UnifiedSourceRef['kind'][]
): UnifiedDetailResolution {
  return {
    status: 'missing-source',
    key: row.key,
    identity: row.identity,
    sourceRefs: row.sourceRefs,
    requiredSourceKinds
  }
}

function targetForRow(row: UnifiedDetailRow): UnifiedDetailResolution {
  const identity = row.identity
  if (identity.kind === 'goal') {
    const refs = exactSourceRefs(row, ['goal'])
    if (refs.length !== 1) {
      return missingSource(row, ['goal'])
    }
    const sourceRef = refs[0]
    return {
      status: 'resolved',
      target: {
        kind: 'goal',
        identity,
        projectKey: identity.projectKey,
        goal: identity.goal,
        boardRevision: sourceRef.revision,
        sourceRef
      }
    }
  }
  if (identity.kind === 'automation') {
    const refs = exactSourceRefs(row, ['native-automation']).filter(
      (sourceRef) => sourceRef.sourceId === identity.automationId
    )
    if (refs.length !== 1) {
      return missingSource(row, ['native-automation'])
    }
    const sourceRef = refs[0]
    return {
      status: 'resolved',
      target: {
        kind: 'automation',
        identity,
        ownerKey: sourceRef.ownerKey,
        revision: sourceRef.revision,
        sourceRef
      }
    }
  }
  if (identity.kind === 'script') {
    const bindings = exactSourceRefs(row, ['runtime-binding'])
    const crons = exactSourceRefs(row, ['legacy-cron'])
    if (bindings.length > 1 || crons.length > 1 || (bindings.length === 0 && crons.length === 0)) {
      return missingSource(row, ['runtime-binding', 'legacy-cron'])
    }
    const bindingRef = bindings[0] ?? null
    return {
      status: 'resolved',
      target: {
        kind: 'script',
        identity,
        bindingAutomationId: bindingRef?.sourceId ?? null,
        bindingRef,
        cronRef: crons[0] ?? null,
        evidence: row.scriptEvidence ?? null
      }
    }
  }
  const refs = exactSourceRefs(row, ['external'])
  if (refs.length !== 1) {
    return missingSource(row, ['external'])
  }
  return {
    status: 'resolved',
    target: { kind: 'external', identity, sourceRef: refs[0] }
  }
}

export function unifiedDetailSelection(row: UnifiedDetailRow): UnifiedDetailSelection {
  return { key: row.key, identity: row.identity, sourceRefs: row.sourceRefs }
}

export function resolveUnifiedDetailTarget(input: {
  selection: UnifiedDetailSelection
  rows: readonly UnifiedDetailRow[]
}): UnifiedDetailResolution {
  const row = input.rows.find(
    (candidate) =>
      candidate.key === input.selection.key &&
      sameIdentity(candidate.identity, input.selection.identity)
  )
  if (!row) {
    return {
      status: 'stale',
      key: input.selection.key,
      identity: input.selection.identity,
      sourceRefs: input.selection.sourceRefs
    }
  }
  return targetForRow(row)
}
