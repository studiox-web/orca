// XOS fork: Tasks → Goals item transition timeline (§3h.2), from transitions.jsonl.
import React from 'react'
import { ArrowRight, GitCommitHorizontal } from 'lucide-react'
import type { XosItemTransition } from '../../../../shared/xos-items-types'
import { relativeTime } from './xos-format'
import { prettyGoal } from './xos-items-model'

export function XosItemTimeline({
  transitions
}: {
  transitions: XosItemTransition[]
}): React.JSX.Element | null {
  if (transitions.length === 0) {
    return null
  }
  return (
    <section className="space-y-2 rounded-md border bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Transition timeline
        </h4>
        <span className="text-[11px] text-muted-foreground">{transitions.length} event(s)</span>
      </div>
      <ol className="space-y-1.5 text-xs">
        {transitions.map((ev) => (
          <li
            key={`${ev.item}-${ev.at}-${ev.fromStage}-${ev.toStage}`}
            className="flex flex-wrap items-center gap-1.5 rounded border bg-background/70 px-2.5 py-1.5"
          >
            <span className="font-mono text-[11px] text-muted-foreground">{ev.fromStage}</span>
            <ArrowRight className="size-3 text-muted-foreground" />
            <span className="font-mono text-[11px] font-semibold">{ev.toStage}</span>
            {ev.outcome && (
              <span className="rounded-full border px-1.5 text-[10px] xos-tone-warning">
                {ev.outcome}
              </span>
            )}
            <span className="text-muted-foreground">by {prettyGoal(ev.goal)}</span>
            {ev.commit && (
              <span className="inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground">
                <GitCommitHorizontal className="size-3" />
                {ev.commit.slice(0, 7)}
              </span>
            )}
            <span className="ml-auto text-[11px] text-muted-foreground">{relativeTime(ev.at)}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
