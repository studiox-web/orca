import { hostStableKey, parseHostStableKey } from './automation-owner-key'
import type {
  UnifiedAutomationIdentity,
  UnifiedAutomationKind,
  UnifiedSourceRef
} from './unified-automation-types'

const VERSION = 'u1'
const SEPARATOR = '|'
const UNIFIED_AUTOMATION_KINDS: readonly UnifiedAutomationKind[] = [
  'goal',
  'automation',
  'script',
  'external'
]

function encodePart(value: string): string {
  return encodeURIComponent(value)
}

function decodePart(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value)
    return encodePart(decoded) === value ? decoded : null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function areStrings(values: readonly (string | null)[]): values is string[] {
  return values.every((value) => value !== null)
}

function isUnifiedAutomationKind(value: string | undefined): value is UnifiedAutomationKind {
  return value !== undefined && UNIFIED_AUTOMATION_KINDS.some((kind) => kind === value)
}

export function isUnifiedSourceRef(value: unknown): value is UnifiedSourceRef {
  if (!isRecord(value) || !isRecord(value.authority)) {
    return false
  }
  const authority = value.authority
  if (!isRecord(authority.authority) || !isRecord(authority.selector)) {
    return false
  }
  const authorityKind = authority.authority.kind
  const validAuthority =
    authorityKind === 'desktop' ||
    (authorityKind === 'runtime' &&
      typeof authority.authority.environmentId === 'string' &&
      authority.authority.environmentId.length > 0)
  const selectorKind = authority.selector.kind
  const validSelector =
    selectorKind === 'self' ||
    selectorKind === 'orphan' ||
    (selectorKind === 'ssh' &&
      typeof authority.selector.targetId === 'string' &&
      authority.selector.targetId.length > 0)
  return (
    validAuthority &&
    validSelector &&
    ['goal', 'native-automation', 'runtime-binding', 'legacy-cron', 'external'].includes(
      String(value.kind)
    ) &&
    typeof value.sourceId === 'string' &&
    value.sourceId.length > 0 &&
    (value.revision === null || typeof value.revision === 'string') &&
    (value.ownerKey === null ||
      (typeof value.ownerKey === 'string' && value.ownerKey.length > 0)) &&
    typeof value.label === 'string' &&
    value.label.length > 0
  )
}

export function encodeUnifiedAutomationKey(identity: UnifiedAutomationIdentity): string {
  const common = [VERSION, identity.kind, hostStableKey(identity.authority)]
  const specific =
    identity.kind === 'goal'
      ? [identity.projectKey, identity.goal]
      : identity.kind === 'automation'
        ? [identity.automationId]
        : identity.kind === 'script'
          ? [identity.sourceId]
          : [identity.managerId, identity.jobId]
  return [...common, ...specific].map(encodePart).join(SEPARATOR)
}

export function decodeUnifiedAutomationKey(key: string): UnifiedAutomationIdentity | null {
  const parts = key.split(SEPARATOR).map(decodePart)
  if (!areStrings(parts) || parts[0] !== VERSION) {
    return null
  }
  const kind = parts[1]
  const authority = parts[2] ? parseHostStableKey(parts[2]) : null
  if (!isUnifiedAutomationKind(kind) || !authority) {
    return null
  }
  if (kind === 'goal' && parts.length === 5 && parts[3] && parts[4]) {
    return { kind, authority, projectKey: parts[3], goal: parts[4] }
  }
  if (kind === 'automation' && parts.length === 4 && parts[3]) {
    return { kind, authority, automationId: parts[3] }
  }
  if (kind === 'script' && parts.length === 4 && parts[3]) {
    return { kind, authority, sourceId: parts[3] }
  }
  if (kind === 'external' && parts.length === 5 && parts[3] && parts[4]) {
    return { kind, authority, managerId: parts[3], jobId: parts[4] }
  }
  return null
}
