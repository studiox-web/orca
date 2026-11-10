import { describe, expect, it } from 'vitest'
import { emptyCrew, type OrchestrationCrewRow } from '../../../../shared/orchestration-crew'
import { projectCoordinatedAttempt } from './coordinated-automation-attempt-projection'

function projectWithCrew(row: OrchestrationCrewRow) {
  const crew = emptyCrew('ok')
  crew.sections.managing.push(row)
  return projectCoordinatedAttempt({
    obs: {
      dispatchId: 'ctx_old',
      taskId: 'task_shared',
      childDefinitionId: 'child_writer',
      technicalStatus: 'failed'
    },
    index: 0,
    activeDispatchId: 'ctx_new',
    stageAcceptance: null,
    crewSnapshot: crew,
    fallbackAgent: 'claude',
    fallbackHostLabel: 'SSH: editorial'
  })
}

describe('attempt crew navigation identity', () => {
  it('does not open the current worker for a historical attempt sharing its Task', () => {
    const projected = projectWithCrew({
      partyKey: 'task_shared',
      role: 'worker',
      label: 'Writer',
      agentKind: 'claude',
      status: 'working',
      sendAddress: 'dispatch:ctx_new',
      openTarget: { kind: 'terminal', handle: 'term_new' }
    })
    expect(projected.canOpenWorker).toBe(false)
    expect(projected.crewRow).toBeNull()
    expect(projected.openWorkerUnavailableReason).toContain('No live chat, terminal, or dispatch')
  })

  it.each([
    { kind: 'chat', sessionId: 'session_old', worktreeId: 'folder:/srv/editorial' },
    { kind: 'terminal', handle: 'term_old' },
    { kind: 'dispatch', address: 'dispatch:ctx_old' }
  ] as const)('uses the exact canonical Dispatch association for a $kind target', (openTarget) => {
    const row: OrchestrationCrewRow = {
      partyKey: '["ssh:editorial","term_old"]',
      role: 'worker',
      label: 'Writer',
      agentKind: 'claude',
      status: 'done',
      sendAddress: 'dispatch:ctx_old',
      openTarget
    }
    const projected = projectWithCrew(row)
    expect(projected.canOpenWorker).toBe(true)
    expect(projected.crewRow).toBe(row)
    expect(projected.dispatchId).toBe('ctx_old')
    expect(projected.isActive).toBe(false)
  })

  it('resolves a canonical dispatch open target without treating partyKey as a Task ID', () => {
    const row: OrchestrationCrewRow = {
      partyKey: '["local","dispatch:ctx_old"]',
      role: 'worker',
      label: 'Writer',
      agentKind: 'claude',
      status: 'done',
      openTarget: { kind: 'dispatch', address: 'dispatch:ctx_old' }
    }
    expect(projectWithCrew(row).crewRow).toBe(row)
  })
})
