import type { Automation, AutomationUpdateInput } from '../../../shared/automations-types'
import { normalizeAutomationSetupDecisionForWorkspaceMode } from './automation-context-migration'

/** Workspace fields only survive in the mode that uses them; explicit nulls clear. */
export function mergeAutomationWorkspaceFields(
  current: Automation,
  definedUpdates: Omit<AutomationUpdateInput, 'launchSetupPatch'>,
  workspaceMode: Automation['workspaceMode']
): Pick<
  Automation,
  'workspaceMode' | 'workspaceId' | 'baseBranch' | 'setupDecision' | 'reuseSession'
> {
  return {
    workspaceMode,
    workspaceId:
      workspaceMode === 'existing'
        ? Object.hasOwn(definedUpdates, 'workspaceId')
          ? (definedUpdates.workspaceId ?? null)
          : current.workspaceId
        : null,
    baseBranch:
      workspaceMode === 'new_per_run'
        ? Object.hasOwn(definedUpdates, 'baseBranch')
          ? (definedUpdates.baseBranch ?? null)
          : (current.baseBranch ?? null)
        : null,
    setupDecision:
      workspaceMode === 'new_per_run'
        ? Object.hasOwn(definedUpdates, 'setupDecision')
          ? normalizeAutomationSetupDecisionForWorkspaceMode(
              workspaceMode,
              definedUpdates.setupDecision
            )
          : normalizeAutomationSetupDecisionForWorkspaceMode(workspaceMode, current.setupDecision)
        : undefined,
    reuseSession:
      workspaceMode === 'existing'
        ? (definedUpdates.reuseSession ?? current.reuseSession ?? false)
        : false
  }
}
