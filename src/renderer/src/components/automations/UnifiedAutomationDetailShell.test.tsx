// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { unifiedDetailSelection } from '../../../../shared/unified-automation-detail'
import type {
  UnifiedAutomationIdentity,
  UnifiedAutomationRow,
  UnifiedScheduleRef,
  UnifiedSourceRef
} from '../../../../shared/unified-automation-types'
import { UnifiedAutomationDetailShell } from './UnifiedAutomationDetailShell'
import { unifiedScriptCommandEvidence } from './UnifiedAutomationDetailScriptEvidence'

const local = {
  authority: { kind: 'desktop' as const },
  selector: { kind: 'self' as const }
}

function source(
  kind: UnifiedSourceRef['kind'],
  sourceId: string,
  revision = 'revision-1'
): UnifiedSourceRef {
  return {
    kind,
    authority: local,
    sourceId,
    revision,
    ownerKey: kind === 'native-automation' ? 'owner:desktop:self' : null,
    label: kind
  }
}

function schedule(
  key: string,
  owner: UnifiedScheduleRef['owner'],
  expression: string,
  sourceRef: UnifiedSourceRef
): UnifiedScheduleRef {
  return {
    key,
    owner,
    format: owner === 'orca' ? 'rrule' : 'cron',
    expression,
    timezone: owner === 'orca' ? 'America/Vancouver' : null,
    timezoneLabel: owner === 'orca' ? 'America/Vancouver' : 'Host/crontab timezone',
    enabled: owner === 'orca',
    nextRunAt: null,
    sourceRef
  }
}

function row(
  identity: UnifiedAutomationIdentity,
  overrides: Partial<UnifiedAutomationRow> = {}
): UnifiedAutomationRow {
  return {
    key: `${identity.kind}-key`,
    identity,
    kind: identity.kind,
    name: 'Nightly review',
    project: 'Orca',
    projectKey: '/projects/orca',
    host: 'This device',
    owner: 'Goal files',
    lifecycle: { state: 'active', stage: 'Ready' },
    scheduleState: 'unscheduled',
    scheduleChildren: [],
    runSummary: null,
    agentId: null,
    migrationState: 'none',
    sourceRefs: [],
    warnings: [],
    readOnly: true,
    ...overrides
  }
}

function renderShell(current: UnifiedAutomationRow, rows = [current]) {
  const callbacks = {
    onBack: vi.fn(),
    onOpenGoal: vi.fn(),
    canOpenNative: vi.fn(() => true),
    onOpenNative: vi.fn(),
    canOpenExternal: vi.fn(() => true),
    onOpenExternal: vi.fn()
  }
  render(
    <TooltipProvider>
      <UnifiedAutomationDetailShell
        selection={unifiedDetailSelection(current)}
        rows={rows}
        lastKnownRow={current}
        {...callbacks}
      />
    </TooltipProvider>
  )
  return callbacks
}

afterEach(cleanup)

describe('UnifiedAutomationDetailShell', () => {
  it('uses Script icons only from explicit command evidence', () => {
    expect(unifiedScriptCommandEvidence('python3 tasks/report.py --dry-run')).toEqual({
      kind: 'python-file',
      filePath: 'tasks/report.py',
      interpreter: 'python3'
    })
    expect(unifiedScriptCommandEvidence('/bin/bash deploy.sh')).toEqual({
      kind: 'shell',
      filePath: null,
      interpreter: '/bin/bash'
    })
    expect(unifiedScriptCommandEvidence('deploy --production')).toEqual({
      kind: 'command',
      filePath: null,
      interpreter: null
    })
  })

  it('keeps a bound Goal as one item while showing every schedule and source', async () => {
    const goalSource = source('goal', '/projects/orca:review')
    const cronSource = source('legacy-cron', 'goal:/projects/orca:review:0', 'cron-revision')
    const nativeSource = source('native-automation', 'automation-1', '42')
    const current = row(
      { kind: 'goal', authority: local, projectKey: '/projects/orca', goal: 'review' },
      {
        scheduleState: 'mixed',
        scheduleChildren: [
          schedule('cron', 'legacy-cron', '0 5 * * *', cronSource),
          schedule('native', 'orca', 'FREQ=DAILY;BYHOUR=6', nativeSource)
        ],
        sourceRefs: [goalSource, cronSource, nativeSource],
        runSummary: {
          source: 'native',
          sourceId: 'run-1',
          identity: 'stable',
          outcome: 'succeeded',
          sourceStatus: 'completed',
          at: '2026-11-08T12:00:00.000Z',
          authorityAttribution: { authority: local, evidence: 'run-context' }
        }
      }
    )
    const callbacks = renderShell(current)

    expect(screen.getByRole('heading', { name: 'Nightly review' })).toBeInTheDocument()
    expect(screen.getByText('0 5 * * *')).toBeVisible()
    expect(screen.getByText('FREQ=DAILY;BYHOUR=6')).toBeVisible()
    expect(screen.getAllByText('native-automation').length).toBeGreaterThan(0)
    expect(screen.getByText('automation-1')).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'Advanced Goal workspace' }))
    await userEvent.click(screen.getByRole('button', { name: 'Open Goal workspace' }))
    expect(callbacks.onOpenGoal).toHaveBeenCalledExactlyOnceWith('/projects/orca', 'review')
  })

  it('delegates an exact native row to the existing detail/editor path', async () => {
    const nativeSource = source('native-automation', 'automation-1', '42')
    const current = row(
      { kind: 'automation', authority: local, automationId: 'automation-1' },
      {
        agentId: 'codex',
        lifecycle: { state: 'present', stage: 'Native definition' },
        sourceRefs: [nativeSource],
        scheduleChildren: [schedule('native', 'orca', 'FREQ=DAILY', nativeSource)]
      }
    )
    const callbacks = renderShell(current)
    const button = screen.getByRole('button', { name: 'Open native automation' })

    expect(button.querySelector('svg, img')).not.toBeNull()
    await userEvent.click(button)
    expect(callbacks.canOpenNative).toHaveBeenCalledWith(current)
    expect(callbacks.onOpenNative).toHaveBeenCalledExactlyOnceWith(current)
  })

  it('shows legacy Script evidence and labels missing structured evidence without controls', () => {
    const cronSource = source('legacy-cron', 'script:backup:0', 'cron-revision')
    const current = row(
      { kind: 'script', authority: local, sourceId: 'cron:backup:0' },
      {
        lifecycle: { state: 'present', stage: 'Legacy definition' },
        sourceRefs: [cronSource],
        scriptEvidence: {
          provenance: 'legacy-cron',
          command: null,
          cwd: null,
          replacesCronCommand: null
        }
      }
    )
    renderShell(current)
    const section = screen.getByRole('heading', { name: 'Reviewed Script evidence' }).parentElement

    expect(section).not.toBeNull()
    expect(screen.getByText('Legacy')).toBeVisible()
    expect(screen.getByText('Missing from the current source data')).toBeVisible()
    expect(screen.getByText('Not explicitly recorded')).toBeVisible()
    expect(screen.getByText('Not separately structured in the current source data')).toBeVisible()
    expect(screen.queryByRole('button', { name: /run|edit|migrate/i })).not.toBeInTheDocument()
  })

  it('blocks stale selections and surfaces conflicts instead of guessing', () => {
    const nativeSource = source('native-automation', 'automation-1')
    const current = row(
      { kind: 'automation', authority: local, automationId: 'automation-1' },
      {
        sourceRefs: [nativeSource],
        warnings: [{ code: 'binding-conflict', message: 'Two exact bindings conflict.' }]
      }
    )
    renderShell(current, [])

    const alert = screen.getByRole('alert')
    expect(within(alert).getByText('This exact selection is stale.')).toBeVisible()
    expect(screen.getByText('binding-conflict')).toBeVisible()
    expect(screen.getByText('Two exact bindings conflict.')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Open native automation' })).not.toBeInTheDocument()
  })

  it('reports a missing exact source without exposing native delegation', () => {
    const current = row(
      { kind: 'automation', authority: local, automationId: 'automation-1' },
      { sourceRefs: [source('native-automation', 'different-id')] }
    )
    renderShell(current)

    const alert = screen.getByRole('alert')
    expect(within(alert).getByText('The required authoritative source is missing.')).toBeVisible()
    expect(within(alert).getByText('Required source kinds: native-automation.')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Open native automation' })).not.toBeInTheDocument()
  })

  it('keeps archived Goals and External rows capability-driven and read-only', async () => {
    const archived = row(
      { kind: 'goal', authority: local, projectKey: '/projects/orca', goal: 'old-goal' },
      {
        lifecycle: { state: 'archived', stage: null },
        sourceRefs: [source('goal', '/projects/orca/_archive/old-goal')]
      }
    )
    const first = renderShell(archived)
    expect(screen.getByRole('heading', { name: 'Archived Goal' })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Advanced Goal workspace' })
    ).not.toBeInTheDocument()
    expect(first.onOpenGoal).not.toHaveBeenCalled()

    cleanup()
    const external = row(
      { kind: 'external', authority: local, managerId: 'manager-1', jobId: 'job-1' },
      { sourceRefs: [source('external', 'job-1')] }
    )
    const externalCallbacks = renderShell(external)
    expect(screen.getByRole('heading', { name: 'External manager detail' })).toBeVisible()
    expect(screen.getByText('Detail only · manager unsupported')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Open in native list' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Open in native list' }))
    expect(externalCallbacks.onOpenExternal).toHaveBeenCalledExactlyOnceWith(external)
    expect(
      screen.queryByRole('button', { name: /open native automation|open goal/i })
    ).not.toBeInTheDocument()
  })

  it('focuses its heading and lets child UI consume Escape before returning', async () => {
    const goalSource = source('goal', '/projects/orca:review')
    const current = row(
      { kind: 'goal', authority: local, projectKey: '/projects/orca', goal: 'review' },
      { sourceRefs: [goalSource] }
    )
    const callbacks = renderShell(current)
    const heading = screen.getByRole('heading', { name: 'Nightly review' })

    await waitFor(() => expect(heading).toHaveFocus())
    heading.addEventListener('keydown', (event) => event.preventDefault(), { once: true })
    await userEvent.keyboard('{Escape}')
    expect(callbacks.onBack).not.toHaveBeenCalled()

    heading.focus()
    await userEvent.keyboard('{Escape}')
    expect(callbacks.onBack).toHaveBeenCalledOnce()
  })
})
