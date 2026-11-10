import type {
  Automation,
  AutomationCreateInput,
  AutomationUpdateInput
} from '../../../../shared/automations-types'
import type { AutomationDestination } from '../../../../shared/automation-owner-precondition'
import { createBrowserUuid } from '@/lib/browser-uuid'
import type { AutomationDraft } from './AutomationEditorDialog'
import type { AutomationCreateDestination } from './automation-create-destination'
import {
  createCoordinatedAutomationAtDestination,
  dispatchCoordinatedAutomationUpdate,
  type CoordinatedDefinitionDraftFields
} from './automation-coordinated-definition-client'
import type {
  AutomationActionNotice,
  AutomationDispatchResult
} from './automation-row-action-dispatch'
import type { AutomationSaveContext } from './automation-save-context'

const COORDINATED_CREATE_KEY = 'coordinated-definition:create'

function ownerNotice(message: string): AutomationActionNotice {
  return { message, recovery: 'retry', severity: 'owner' }
}

/** Client-side completeness checks; the host re-validates the full definition. */
export function coordinatedDraftDefinition(
  draft: AutomationDraft
): { ok: true; definition: CoordinatedDefinitionDraftFields } | { ok: false; message: string } {
  if (!draft.outcomeContract?.humanStatement.trim()) {
    return { ok: false, message: 'Describe the outcome before saving.' }
  }
  if (!draft.children || draft.children.length === 0) {
    return { ok: false, message: 'Add at least one worker before saving.' }
  }
  return {
    ok: true,
    definition: {
      outcomeContract: draft.outcomeContract,
      children: draft.children,
      inheritedDefaults: draft.inheritedDefaults,
      globalCeilings: draft.globalCeilings,
      publicationPolicy: draft.publicationPolicy,
      retentionPolicy: draft.retentionPolicy
    }
  }
}

export type CoordinatedSaveInput = {
  definition: CoordinatedDefinitionDraftFields
  currentAutomation: Automation | null
  createInput: AutomationCreateInput
  updates: AutomationUpdateInput
  createDestination: AutomationCreateDestination | null
  editDestination: AutomationDestination | undefined
  moveTarget: AutomationCreateDestination | null
}

/** Writes a coordinated definition through the dedicated RPCs. The draft stays
 * open on every refusal, so a revision or owner conflict never discards edits. */
export async function saveCoordinatedDefinition(
  context: AutomationSaveContext,
  input: CoordinatedSaveInput
): Promise<AutomationDispatchResult<Automation>> {
  const { local, destination } = context
  if (input.moveTarget) {
    return {
      ok: false,
      notice: ownerNotice('Coordinated automations cannot be moved to another host yet.')
    }
  }
  if (local.editingAutomationId === null) {
    if (!input.createDestination) {
      return {
        ok: false,
        notice: ownerNotice('Choose an available project on this host before saving.')
      }
    }
    // Why: reuse one idempotency key until the create is confirmed, so an
    // uncertain transport failure replays instead of creating a duplicate.
    const keys = local.moveCreationKeysRef.current
    const creationKey = keys.get(COORDINATED_CREATE_KEY) ?? createBrowserUuid()
    keys.set(COORDINATED_CREATE_KEY, creationKey)
    const created = await createCoordinatedAutomationAtDestination(
      input.createDestination.authority,
      { ...input.createInput, creationKey },
      input.definition,
      input.createDestination.destination
    )
    if (created.ok) {
      keys.delete(COORDINATED_CREATE_KEY)
      destination.invalidateWrittenHost(input.createDestination.entry.stableRef, 'definition')
    }
    return created
  }
  const current = input.currentAutomation
  const openedRevision = local.draft.definitionRevision
  if (!current || openedRevision === undefined) {
    return {
      ok: false,
      notice: ownerNotice('This automation is no longer available. Refresh and try again.')
    }
  }
  if (current.definitionRevision !== openedRevision) {
    return {
      ok: false,
      notice: ownerNotice(
        `This coordinated automation changed to Rev ${current.definitionRevision ?? '?'} after you opened Rev ${openedRevision}. Your edits are kept; copy them, reopen the automation, and apply them again.`
      )
    }
  }
  return await dispatchCoordinatedAutomationUpdate(
    destination.automationDispatchContext,
    { rowKey: local.editingRowKey ?? '', automationId: current.id },
    input.updates,
    input.definition,
    openedRevision,
    input.editDestination
  )
}
