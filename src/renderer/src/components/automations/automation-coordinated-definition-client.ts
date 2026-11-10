/** Coordinated definition writes go only through the host's dedicated
 * `automation.createCoordinated` / `automation.updateCoordinated` RPCs. The host
 * keeps every record disabled and refuses non-local owners; this client refuses
 * before any write when the capability is not advertised, and never falls back
 * to the ordinary single-automation create/update path. */

import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import type {
  Automation,
  AutomationCreateInput,
  AutomationUpdateInput,
  CoordinatedAutomationDefinitionFields
} from '../../../../shared/automations-types'
import type { RuntimeStatus } from '../../../../shared/runtime-types'
import type { AutomationAuthorityRef } from '../../../../shared/automation-owner-ref'
import type {
  AutomationDestination,
  AutomationOwnerPrecondition
} from '../../../../shared/automation-owner-precondition'
import { COORDINATED_AUTOMATION_DEFINITIONS_RUNTIME_CAPABILITY } from '../../../../shared/automation-runtime-capabilities'
import {
  toRuntimeAutomationCreateInput,
  toRuntimeAutomationUpdateInput
} from './automation-host-client'
import {
  AutomationHostScopeUnsupportedError,
  prepareAutomationLaunchSetup,
  REQUEST_TIMEOUT_MS
} from './automation-capability-probe'
import { automationActionAvailability, capturedAutomationOwner } from './automation-captured-owner'
import { classifyAutomationActionError } from './automation-owner-action-runner'
import {
  toDispatchResult,
  type AutomationDispatchContext,
  type AutomationDispatchResult
} from './automation-row-action-dispatch'

export const COORDINATED_DEFINITION_REMOTE_UNSUPPORTED_MESSAGE =
  'Coordinated automations can only be saved on this computer for now. Remote and SSH hosts are not supported yet.'
export const COORDINATED_DEFINITION_CAPABILITY_MISSING_MESSAGE =
  'This Orca host is not accepting coordinated automation definitions. Enable the experimental coordinated automations setting in a development build and try again.'
export const COORDINATED_DEFINITION_UNCAPTURED_OWNER_MESSAGE =
  'This coordinated automation has no confirmed local owner yet. Refresh the list and try again.'

/** Only the definition fields a client may author; host-managed fields
 * (revision, tombstones, fingerprint) are never sent. */
export type CoordinatedDefinitionDraftFields = Required<
  Pick<CoordinatedAutomationDefinitionFields, 'outcomeContract' | 'children'>
> &
  Pick<
    CoordinatedAutomationDefinitionFields,
    'inheritedDefaults' | 'globalCeilings' | 'publicationPolicy' | 'retentionPolicy'
  >

function definedOnly(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
}

/** Refuses before any write unless the local desktop host advertises the gate. */
export async function assertCoordinatedDefinitionWritesSupported(
  authority: AutomationAuthorityRef,
  selector: AutomationOwnerPrecondition['selector'] = { kind: 'self' }
): Promise<void> {
  if (authority.kind !== 'desktop' || selector.kind !== 'self') {
    throw new AutomationHostScopeUnsupportedError(COORDINATED_DEFINITION_REMOTE_UNSUPPORTED_MESSAGE)
  }
  // Why uncached: the gate follows a live setting and must be re-read per write.
  const status = await callRuntimeRpc<RuntimeStatus>({ kind: 'local' }, 'status.get', undefined, {
    timeoutMs: REQUEST_TIMEOUT_MS
  })
  if (!status.capabilities?.includes(COORDINATED_AUTOMATION_DEFINITIONS_RUNTIME_CAPABILITY)) {
    throw new AutomationHostScopeUnsupportedError(COORDINATED_DEFINITION_CAPABILITY_MISSING_MESSAGE)
  }
}

export type CoordinatedDefinitionCreateSubmission = {
  authority: AutomationAuthorityRef
  input: AutomationCreateInput
  definition: CoordinatedDefinitionDraftFields
  destination: AutomationDestination
  wireInput?: Record<string, unknown>
}

export async function createCoordinatedAutomationAtDestination(
  submission: CoordinatedDefinitionCreateSubmission
): Promise<AutomationDispatchResult<Automation>> {
  const { authority, input, definition, destination } = submission
  try {
    await assertCoordinatedDefinitionWritesSupported(authority, destination.selector)
    if (!submission.wireInput) {
      const prepared = await prepareAutomationLaunchSetup(authority, input)
      const { enabled: _enabled, ...wire } = toRuntimeAutomationCreateInput(prepared)
      // Keep the exact submitted payload, including launch setup and dtstart, for uncertain replay.
      submission.wireInput = structuredClone({
        ...definedOnly(wire),
        ...definedOnly(definition),
        kind: 'coordinated',
        enabled: false,
        destination
      })
    }
    const result = await callRuntimeRpc<{ automation: Automation }>(
      { kind: 'local' },
      'automation.createCoordinated',
      submission.wireInput,
      { timeoutMs: REQUEST_TIMEOUT_MS }
    )
    return { ok: true, value: result.automation }
  } catch (error) {
    return toDispatchResult(classifyAutomationActionError(error))
  }
}

async function updateCoordinatedFenced(
  authority: AutomationAuthorityRef,
  id: string,
  updates: AutomationUpdateInput,
  definition: CoordinatedDefinitionDraftFields,
  expectedDefinitionRevision: number,
  expectedOwner: AutomationOwnerPrecondition,
  destination: AutomationDestination | undefined
): Promise<Automation> {
  await assertCoordinatedDefinitionWritesSupported(authority, expectedOwner.selector)
  if (destination && destination.selector.kind !== 'self') {
    throw new AutomationHostScopeUnsupportedError(COORDINATED_DEFINITION_REMOTE_UNSUPPORTED_MESSAGE)
  }
  const prepared = await prepareAutomationLaunchSetup(authority, updates)
  const { enabled: _enabled, ...wire } = toRuntimeAutomationUpdateInput(prepared)
  const result = await callRuntimeRpc<{ automation: Automation }>(
    { kind: 'local' },
    'automation.updateCoordinated',
    {
      id,
      updates: {
        ...definedOnly(wire),
        // Why: the complete authored definition is sent so child IDs, inheritance,
        // and policies survive exactly; the host rejects a stale revision.
        ...definedOnly(definition),
        expectedDefinitionRevision
      },
      expectedOwner,
      ...(destination ? { destination } : {})
    },
    { timeoutMs: REQUEST_TIMEOUT_MS }
  )
  return result.automation
}

/** Owner-fenced coordinated update. Unlike ordinary rows there is no unfenced
 * legacy fallback: an uncaptured owner refuses before any write. */
export async function dispatchCoordinatedAutomationUpdate(
  context: AutomationDispatchContext,
  row: { rowKey: string; automationId: string },
  updates: AutomationUpdateInput,
  definition: CoordinatedDefinitionDraftFields,
  expectedDefinitionRevision: number,
  destination: AutomationDestination | undefined
): Promise<AutomationDispatchResult<Automation>> {
  const captured = capturedAutomationOwner(context.capturedOwners, row.rowKey)
  const availability = automationActionAvailability(captured, 'save')
  if (availability.kind === 'blocked') {
    return toDispatchResult({ status: 'blocked', block: availability.block })
  }
  if (availability.kind !== 'owned') {
    return {
      ok: false,
      notice: {
        message: COORDINATED_DEFINITION_UNCAPTURED_OWNER_MESSAGE,
        recovery: 'retry',
        severity: 'owner'
      }
    }
  }
  try {
    return {
      ok: true,
      value: await updateCoordinatedFenced(
        availability.owner.authority,
        row.automationId,
        updates,
        definition,
        expectedDefinitionRevision,
        availability.precondition,
        destination
      )
    }
  } catch (error) {
    return toDispatchResult(classifyAutomationActionError(error))
  }
}
