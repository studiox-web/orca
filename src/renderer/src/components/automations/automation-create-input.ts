import type {
  Automation,
  AutomationCreateInput,
  AutomationUpdateInput
} from '../../../../shared/automations-types'
import type { AutomationDraft } from './AutomationEditorDialog'

type OrcaAutomationCreateValues = Pick<
  AutomationCreateInput,
  'precheck' | 'runContext' | 'setupDecision' | 'timezone' | 'rrule' | 'missedRunGraceMinutes'
> & {
  launchSetup: Pick<AutomationUpdateInput, 'launchSetupPatch' | 'extraAgentArgs'>
  updates: AutomationUpdateInput
  now: number
}

/** Full create payload: the saved record's values (for moves) overlaid with this edit. */
export function buildOrcaAutomationCreateInput(
  current: Automation | null,
  draft: AutomationDraft,
  v: OrcaAutomationCreateValues
): AutomationCreateInput {
  return {
    name: current ? current.name : draft.name,
    prompt: current ? current.prompt : draft.prompt,
    precheck: current ? current.precheck : v.precheck,
    agentId: current ? current.agentId : draft.agentId,
    ...v.launchSetup,
    runContext: current ? current.runContext : v.runContext,
    projectId: current ? current.projectId : draft.projectId,
    workspaceMode: current ? current.workspaceMode : draft.workspaceMode,
    workspaceId: current ? current.workspaceId : draft.workspaceId,
    baseBranch: current ? current.baseBranch : draft.baseBranch.trim() || null,
    setupDecision: current ? current.setupDecision : v.setupDecision,
    reuseSession: current
      ? current.reuseSession
      : draft.workspaceMode === 'existing' && draft.reuseSession,
    timezone: v.timezone,
    rrule: current ? current.rrule : v.rrule,
    dtstart: current ? current.dtstart : (v.updates.dtstart ?? v.now),
    missedRunGraceMinutes: current ? current.missedRunGraceMinutes : v.missedRunGraceMinutes,
    ...v.updates
  }
}
