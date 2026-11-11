import type {
  Automation,
  AutomationCreateInput,
  AutomationUpdateInput
} from '../../../../shared/automations-types'
import type { AutomationDestination } from '../../../../shared/automation-owner-precondition'
import type { StableAutomationCatalogRef } from '../../../../shared/automation-owner-ref'
import type { AutomationDraft } from './AutomationEditorDialog'
import type { AutomationCreateDestination } from './automation-create-destination'
import {
  createCoordinatedAutomationAtDestination,
  dispatchCoordinatedAutomationUpdate,
  type CoordinatedDefinitionCreateSubmission,
  type CoordinatedDefinitionDraftFields
} from './automation-coordinated-definition-client'
import type {
  AutomationActionNotice,
  AutomationDispatchResult
} from './automation-row-action-dispatch'
import type { AutomationSaveContext } from './automation-save-context'
import { translate } from '@/i18n/i18n'

export type CoordinatedCreateIntent = {
  creationKey: string
  submission: {
    draftSignature: string
    request: CoordinatedDefinitionCreateSubmission
    host: StableAutomationCatalogRef
    confirmed: Automation | null
  } | null
}

function ownerNotice(message: string): AutomationActionNotice {
  return { message, recovery: 'retry', severity: 'owner' }
}

/** Client-side completeness checks; the host re-validates the full definition. */
export function coordinatedDraftDefinition(
  draft: AutomationDraft
): { ok: true; definition: CoordinatedDefinitionDraftFields } | { ok: false; message: string } {
  if (!draft.outcomeContract?.humanStatement.trim()) {
    return {
      ok: false,
      message: translate(
        'auto.components.automations.automation.coordinated.save.b35475c933',
        'Describe the outcome before saving.'
      )
    }
  }
  if (!draft.children || draft.children.length === 0) {
    return {
      ok: false,
      message: translate(
        'auto.components.automations.automation.coordinated.save.891cf7af8e',
        'Add at least one worker before saving.'
      )
    }
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

async function saveCoordinatedCreate(
  context: AutomationSaveContext,
  input: CoordinatedSaveInput
): Promise<AutomationDispatchResult<Automation>> {
  const { local } = context
  const intent = local.coordinatedCreateIntentRef.current
  if (!intent || !input.createDestination) {
    return {
      ok: false,
      notice: ownerNotice(
        translate(
          'auto.components.automations.automation.coordinated.save.36bad74be5',
          'Reopen the create dialog and choose an available project before saving.'
        )
      )
    }
  }
  intent.submission ??= {
    draftSignature: JSON.stringify(local.draft),
    request: structuredClone({
      authority: input.createDestination.authority,
      input: { ...input.createInput, creationKey: intent.creationKey },
      definition: input.definition,
      destination: input.createDestination.destination
    }),
    host: input.createDestination.entry.stableRef,
    confirmed: null
  }
  return await reconcileCoordinatedCreate(context, intent)
}

export async function reconcileCoordinatedCreate(
  context: AutomationSaveContext,
  intent: CoordinatedCreateIntent
): Promise<AutomationDispatchResult<Automation>> {
  const { local, destination } = context
  const submission = intent.submission
  if (!submission) {
    return {
      ok: false,
      notice: ownerNotice(
        translate(
          'auto.components.automations.automation.coordinated.save.60df576174',
          'No submitted creation is available to reconcile.'
        )
      )
    }
  }
  const created: AutomationDispatchResult<Automation> = submission.confirmed
    ? { ok: true, value: submission.confirmed }
    : await createCoordinatedAutomationAtDestination(submission.request)
  if (!created.ok) {
    if (!submission.request.wireInput) {
      intent.submission = null
    }
    return created
  }
  submission.confirmed = created.value
  destination.invalidateWrittenHost(submission.host, 'definition')
  if (
    local.coordinatedCreateIntentRef.current !== intent ||
    JSON.stringify(local.draftRef.current) !== submission.draftSignature
  ) {
    return {
      ok: false,
      notice: {
        message: translate(
          'auto.components.automations.automation.coordinated.save.18c25847c7',
          'The original creation is confirmed as "{{value0}}" ({{value1}}). Your current edits are not saved and remain in this dialog. Copy them, close this dialog, then reopen that automation to apply them. A new create dialog starts a separate automation.',
          { value0: created.value.name, value1: created.value.id }
        ),
        recovery: null,
        severity: 'owner'
      }
    }
  }
  return created
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
      notice: ownerNotice(
        translate(
          'auto.components.automations.automation.coordinated.save.a19b5e18a6',
          'Coordinated automations cannot be moved to another host yet.'
        )
      )
    }
  }
  if (local.editingAutomationId === null) {
    return await saveCoordinatedCreate(context, input)
  }
  const current = input.currentAutomation
  const openedRevision = local.draft.definitionRevision
  if (!current || openedRevision === undefined) {
    return {
      ok: false,
      notice: ownerNotice(
        translate(
          'auto.components.automations.automation.coordinated.save.fe3728047a',
          'This automation is no longer available. Refresh and try again.'
        )
      )
    }
  }
  if (current.definitionRevision !== openedRevision) {
    return {
      ok: false,
      notice: ownerNotice(
        translate(
          'auto.components.automations.automation.coordinated.save.6b2a4b4eae',
          'This coordinated automation changed to Rev {{value0}} after you opened Rev {{value1}}. Your edits are kept; copy them, reopen the automation, and apply them again.',
          { value0: current.definitionRevision ?? '?', value1: openedRevision }
        )
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
