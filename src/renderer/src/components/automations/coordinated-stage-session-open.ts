import { openOrchestrationCrewAgent } from '@/lib/open-agent-message-sender'
import type { AutomationOwnerRef } from '../../../../shared/automation-owner-ref'
import type { CoordinatedStageInspection } from '../../../../shared/coordinated-automation-run-inspection'
import { getAutomationAuthorityTarget } from './automation-host-client'

/**
 * Why a stage's worker cannot be opened, or null when the host minted a terminal for exactly this
 * stage's current attempt. A Dispatch id alone is never treated as a session.
 */
export function stageSessionOpenRefusal(stage: CoordinatedStageInspection): string | null {
  const target = stage.sessionTarget
  if (target.kind !== 'terminal') {
    return target.reason
  }
  if (target.childDefinitionId !== stage.childDefinitionId || target.taskId !== stage.taskId) {
    return 'The host session target names a different stage or Task. It was not opened.'
  }
  if (stage.native.kind !== 'available' || stage.native.latestDispatchId !== target.dispatchId) {
    return 'The host session target is not the stage’s current attempt. Refresh to inspect the exact run.'
  }
  return null
}

/** Opens the host-minted worker terminal on the owning authority through native crew navigation. */
export async function openCoordinatedStageSession(
  stage: CoordinatedStageInspection,
  owner: AutomationOwnerRef,
  hostLabel?: string
): Promise<void> {
  const target = stage.sessionTarget
  if (target.kind !== 'terminal' || stageSessionOpenRefusal(stage) !== null) {
    return
  }
  await openOrchestrationCrewAgent(
    {
      partyKey: target.paneKey,
      role: 'worker',
      label: stage.name,
      agentKind: stage.role,
      status: stage.native.kind === 'available' ? stage.native.taskStatus : 'unknown',
      ...(hostLabel ? { hostLabel } : {}),
      openTarget: { kind: 'terminal', handle: target.handle }
    },
    getAutomationAuthorityTarget(owner.authority)
  )
}
