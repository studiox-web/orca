// XOS fork: GD2 recent runs of an automation as the fork recorded them: the model each run used and
// why (Auto's pick, a fallback, a before-launch skip), how long it ran, how it ended, and what the
// post-run commit did.
import React from 'react'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { TUI_AGENT_DISPLAY_NAMES } from '../../../../shared/tui-agent-display-names'
import type {
  XosModelChoice,
  XosRunAttempt,
  XosRunCommit
} from '../../../../shared/xos-runtime-types'
import { formatDuration, relativeTime } from './xos-format'

export function choiceLabel(choice: XosModelChoice): string {
  const agent = TUI_AGENT_DISPLAY_NAMES[choice.agent as TuiAgent] ?? choice.agent
  return [agent, choice.model ?? 'default model', choice.effort].filter(Boolean).join(' · ')
}

const OUTCOME: Record<string, { text: string; tone: string }> = {
  ok: { text: 'finished', tone: 'xos-tone-success' },
  failed: { text: 'failed', tone: 'xos-tone-danger' },
  'usage-limit': { text: 'usage limit', tone: 'xos-tone-warning' },
  overloaded: { text: 'overloaded', tone: 'xos-tone-warning' },
  auth: { text: 'not signed in', tone: 'xos-tone-danger' },
  'missing-binary': { text: 'agent missing', tone: 'xos-tone-danger' }
}

function commitText(commit: XosRunCommit): { text: string; tone: string } {
  if (commit.status === 'committed') {
    const pushed =
      commit.pushed === true ? ', pushed' : commit.pushed === false ? ', push failed' : ''
    return {
      text: `${commit.sha ?? 'committed'} · ${commit.files} file${commit.files === 1 ? '' : 's'}${pushed}`,
      tone: commit.pushed === false ? 'xos-tone-warning' : 'xos-tone-neutral'
    }
  }
  if (commit.status === 'nothing') {
    return { text: 'no changes', tone: 'xos-tone-neutral' }
  }
  return {
    text: commit.status === 'failed' ? 'commit failed' : 'not committed',
    tone: commit.status === 'failed' ? 'xos-tone-danger' : 'xos-tone-warning'
  }
}

function AttemptRow({ attempt }: { attempt: XosRunAttempt }): React.JSX.Element {
  const outcome = attempt.outcome ? OUTCOME[attempt.outcome.kind] : null
  const seconds = attempt.outcome
    ? (Date.parse(attempt.outcome.at) - Date.parse(attempt.at)) / 1000
    : null
  const commit = attempt.commit ? commitText(attempt.commit) : null
  return (
    <li className="space-y-0.5 text-xs">
      <div className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-muted-foreground">{relativeTime(attempt.at)}</span>
        <span className="min-w-0 flex-1 truncate">
          {attempt.attempt > 0 ? `↳ ${attempt.attempt}: ` : ''}
          {choiceLabel(attempt)}
        </span>
        {seconds !== null && (
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {formatDuration(seconds)}
          </span>
        )}
        {commit && (
          <span
            className={`shrink-0 rounded-full border px-1.5 ${commit.tone}`}
            title={attempt.commit?.detail ?? undefined}
          >
            {commit.text}
          </span>
        )}
        <span
          className={`shrink-0 rounded-full border px-1.5 ${outcome?.tone ?? 'xos-tone-neutral'}`}
        >
          {outcome?.text ?? 'running'}
        </span>
      </div>
      {(attempt.reason || (attempt.outcome?.kind !== 'ok' && attempt.outcome?.detail)) && (
        <div
          className="truncate pl-[4.5rem] text-muted-foreground"
          title={attempt.outcome?.detail ?? attempt.reason ?? undefined}
        >
          {[attempt.reason, attempt.outcome?.kind !== 'ok' ? attempt.outcome?.detail : null]
            .filter(Boolean)
            .join(' — ')}
        </div>
      )}
    </li>
  )
}

export function XosRunHistory({
  attempts
}: {
  attempts: XosRunAttempt[]
}): React.JSX.Element | null {
  if (attempts.length === 0) {
    return null
  }
  return (
    <div className="space-y-1 border-t pt-2">
      <div className="text-[11px] font-medium uppercase text-muted-foreground">Recent runs</div>
      <ul className="space-y-1.5">
        {attempts.map((attempt) => (
          <AttemptRow key={attempt.runId} attempt={attempt} />
        ))}
      </ul>
    </div>
  )
}
