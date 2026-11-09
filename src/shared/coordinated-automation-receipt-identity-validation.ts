import type { AutomationExecutionTargetType } from './automations-types'
import type { CoordinatedRunChildMapping } from './coordinated-automation-saga-types'
import type { ResolvedAutomationRunSnapshot } from './coordinated-automation-types'
import type {
  ReceiptValidationContext,
  SemanticCompletionReceipt
} from './coordinated-automation-receipt-types'

export type ParsedExecutionAuthority = {
  type: AutomationExecutionTargetType
  id: string
}

/**
 * Parses an exact `<type>:<id>` execution authority. Bare `local`, bare ids, and padded or
 * empty ids are rejected so equality checks cannot be satisfied by prefixes or substrings.
 */
export function parseExecutionAuthority(value: string): ParsedExecutionAuthority | null {
  const sep = value.indexOf(':')
  if (sep <= 0) {
    return null
  }
  const type = value.slice(0, sep)
  const id = value.slice(sep + 1)
  if (type !== 'local' && type !== 'ssh') {
    return null
  }
  if (id.length === 0 || id.trim() !== id || /\s/.test(id)) {
    return null
  }
  return { type, id }
}

function sameAuthority(a: ParsedExecutionAuthority, b: ParsedExecutionAuthority): boolean {
  return a.type === b.type && a.id === b.id
}

function isBlank(value: string): boolean {
  return value.trim().length === 0
}

export function validateTrustedContextShape(
  context: ReceiptValidationContext,
  errors: string[]
): void {
  const required: [string, string][] = [
    ['trustedAuthorIdentity', context.trustedAuthorIdentity],
    ['trustedHostId', context.trustedHostId],
    ['trustedExecutionAuthority', context.trustedExecutionAuthority],
    ['automationRunId', context.automationRunId],
    ['orchestrationRunId', context.orchestrationRunId],
    ['activeAttempt.taskId', context.activeAttempt.taskId],
    ['activeAttempt.dispatchId', context.activeAttempt.dispatchId]
  ]
  for (const [name, value] of required) {
    if (isBlank(value)) {
      errors.push(`Trusted receipt validation context is missing "${name}".`)
    }
  }
}

export function validateReceiptRunIdentity(
  receipt: SemanticCompletionReceipt,
  snapshot: ResolvedAutomationRunSnapshot,
  context: ReceiptValidationContext,
  errors: string[]
): void {
  const chain = receipt.identityChain
  if (chain.hostId !== snapshot.executionTarget.id) {
    errors.push(
      `Receipt identityChain.hostId "${chain.hostId}" does not match snapshot executionTarget id "${snapshot.executionTarget.id}".`
    )
  }
  if (chain.hostId !== context.trustedHostId) {
    errors.push(
      `Receipt identityChain.hostId "${chain.hostId}" does not match trusted context hostId "${context.trustedHostId}".`
    )
  }
  if (chain.automationRunId !== context.automationRunId) {
    errors.push(
      `Receipt identityChain.automationRunId "${chain.automationRunId}" does not match trusted automationRunId "${context.automationRunId}".`
    )
  }
  if (chain.orchestrationRunId !== context.orchestrationRunId) {
    errors.push(
      `Receipt identityChain.orchestrationRunId "${chain.orchestrationRunId}" does not match trusted orchestrationRunId "${context.orchestrationRunId}".`
    )
  }
  if (
    chain.activeAttempt.taskId !== context.activeAttempt.taskId ||
    chain.activeAttempt.dispatchId !== context.activeAttempt.dispatchId
  ) {
    errors.push(
      `Receipt identityChain.activeAttempt does not match trusted active attempt "${context.activeAttempt.taskId}/${context.activeAttempt.dispatchId}".`
    )
  }

  const target: ParsedExecutionAuthority = {
    type: snapshot.executionTarget.type,
    id: snapshot.executionTarget.id
  }
  const receiptAuth = parseExecutionAuthority(chain.targetExecutionAuthority)
  const trustedAuth = parseExecutionAuthority(context.trustedExecutionAuthority)
  if (!receiptAuth || !sameAuthority(receiptAuth, target)) {
    errors.push(
      `Receipt targetExecutionAuthority "${chain.targetExecutionAuthority}" does not match snapshot executionTarget "${target.type}:${target.id}".`
    )
  }
  if (!trustedAuth || !sameAuthority(trustedAuth, target)) {
    errors.push(
      `Trusted execution authority "${context.trustedExecutionAuthority}" does not match snapshot executionTarget "${target.type}:${target.id}".`
    )
  } else if (receiptAuth && !sameAuthority(receiptAuth, trustedAuth)) {
    errors.push(
      `Receipt targetExecutionAuthority "${chain.targetExecutionAuthority}" does not match trusted execution authority "${context.trustedExecutionAuthority}".`
    )
  }
}

function indexMappings(
  label: string,
  mappings: readonly CoordinatedRunChildMapping[] | undefined,
  snapshot: ResolvedAutomationRunSnapshot,
  errors: string[]
): Map<string, CoordinatedRunChildMapping> {
  const index = new Map<string, CoordinatedRunChildMapping>()
  const children = new Map(snapshot.resolvedChildren.map((c) => [c.childDefinitionId, c]))
  if (!mappings) {
    errors.push(`${label} taskMappings are required.`)
    return index
  }
  for (const m of mappings) {
    const child = children.get(m.childDefinitionId)
    if (!child) {
      errors.push(
        `${label} taskMapping references unknown childDefinitionId "${m.childDefinitionId}".`
      )
    } else if (!child.enabled) {
      errors.push(`${label} taskMapping references disabled child "${m.childDefinitionId}".`)
    }
    if (index.has(m.childDefinitionId)) {
      errors.push(
        `${label} taskMapping contains duplicate mapping for childDefinitionId "${m.childDefinitionId}".`
      )
      continue
    }
    index.set(m.childDefinitionId, m)
  }
  for (const child of snapshot.resolvedChildren) {
    if (child.enabled && !index.has(child.childDefinitionId)) {
      errors.push(`${label} is missing taskMapping for enabled child "${child.childDefinitionId}".`)
    }
  }
  return index
}

export function validateReceiptTaskMappings(
  receipt: SemanticCompletionReceipt,
  snapshot: ResolvedAutomationRunSnapshot,
  context: ReceiptValidationContext,
  errors: string[]
): void {
  const receiptIndex = indexMappings(
    'Receipt',
    receipt.identityChain.taskMappings,
    snapshot,
    errors
  )
  const trustedIndex = indexMappings(
    'Trusted context',
    context.trustedTaskMappings,
    snapshot,
    errors
  )
  for (const [childId, m] of receiptIndex) {
    const trusted = trustedIndex.get(childId)
    if (!trusted) {
      continue
    }
    if (m.taskId !== trusted.taskId || (m.dispatchId ?? null) !== (trusted.dispatchId ?? null)) {
      errors.push(
        `Receipt taskMapping for child "${childId}" does not exactly match the trusted mapping (task "${trusted.taskId}", dispatch "${trusted.dispatchId ?? 'null'}").`
      )
    }
  }
}
