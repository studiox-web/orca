// XOS fork: the §3e / §3h.2 drill-in dialog. "Continue on…" starts a new session on another
// agent/model, primed with the goal prompt and the failed run's log context; "Work on it myself"
// opens the same interactive session; "Build now" claims the next eligible item and starts an
// autonomous native run in a fresh worktree. Model choices come from the live catalog (§3.2).
import React, { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { isTuiAgent } from '../../../../shared/tui-agent-config'
import {
  xosAgentTakesEffort,
  xosModelArgsSupported,
  type XosModelArgs
} from '../../../../shared/xos-model-args'
import type { XosModelList } from '../../../../shared/xos-runtime-types'
import type {
  XosGoal,
  XosGoalRun,
  XosNextGoalItem,
  XosProject
} from '../../../../shared/xos-goals-types'
import { LiveRunStatusChip, useXosLiveTail } from './XosLiveRunTail'

export type XosDrillInMode = 'continue-on' | 'work-myself' | 'build-now'

export type XosContinueOnDialogRequest = {
  mode: XosDrillInMode
  goal: XosGoal
  project: XosProject
  fromRun?: XosGoalRun | null
}

const MODE_COPY: Record<XosDrillInMode, { title: string; confirm: string; description: string }> = {
  'continue-on': {
    title: 'Continue on…',
    confirm: 'Start takeover session',
    description:
      'Start a new session primed with the goal contract and the previous run context. Review the draft prompt and press Enter.'
  },
  'work-myself': {
    title: 'Work on it myself',
    confirm: 'Open my session',
    description:
      'Claim the next ready item and open an interactive agent session on it, with the goal prompt prefilled.'
  },
  'build-now': {
    title: 'Build now',
    confirm: 'Start the build',
    description:
      'Claim the next ready item and run the goal on it autonomously in a fresh worktree, with live output below.'
  }
}

const GENERIC_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const FALLBACK_AGENTS: TuiAgent[] = ['claude', 'codex']
const modelCache = new Map<string, Promise<XosModelList>>()

function loadModels(agent: string): Promise<XosModelList> {
  const api = window.api?.xosGoals
  if (!api) {
    return Promise.resolve({ status: 'unavailable', message: 'Not available in this build.' })
  }
  let pending = modelCache.get(agent)
  if (!pending) {
    pending = api.listModels({ agent })
    modelCache.set(agent, pending)
    void pending.then((result) => result.status !== 'ok' && modelCache.delete(agent))
  }
  return pending
}

function agentOptions(goal: XosGoal): TuiAgent[] {
  const allowed = goal.viewer.agents.filter(isTuiAgent)
  return allowed.length > 0 ? allowed : FALLBACK_AGENTS
}

export function XosContinueOnDialog({
  request,
  onClose
}: {
  request: XosContinueOnDialogRequest | null
  onClose: () => void
}): React.JSX.Element {
  const [agent, setAgent] = useState<TuiAgent>('claude')
  const [list, setList] = useState<XosModelList | null>(null)
  const [choice, setChoice] = useState<XosModelArgs>({ model: null, effort: null })
  const [message, setMessage] = useState('')
  const [withContext, setWithContext] = useState(true)
  const [nextItem, setNextItem] = useState<XosNextGoalItem>(null)
  const [pending, setPending] = useState(false)
  const goal = request?.goal ?? null
  const liveTail = useXosLiveTail(
    request?.project.key ?? '',
    goal?.goal ?? '',
    request?.mode === 'build-now'
  )

  useEffect(() => {
    if (!request) {
      return
    }
    const options = agentOptions(request.goal)
    setAgent(options[0] ?? 'claude')
    setChoice({ model: request.goal.viewer.configuredModel, effort: null })
    setMessage('')
    setWithContext(true)
    setNextItem(null)
    if (request.mode !== 'continue-on' && window.api.xosGoals) {
      void window.api.xosGoals
        .nextItem({ projectKey: request.project.key, goal: request.goal.goal })
        .then(setNextItem)
    }
  }, [request])

  useEffect(() => {
    if (!request || !xosModelArgsSupported(agent)) {
      setList(null)
      return
    }
    let cancelled = false
    setList(null)
    void loadModels(agent).then((result) => !cancelled && setList(result))
    return () => {
      cancelled = true
    }
  }, [agent, request])

  if (!request || !goal) {
    return <Dialog open={false} onOpenChange={() => {}} />
  }
  const copy = MODE_COPY[request.mode]
  const models = list?.status === 'ok' ? list.models : []
  const efforts =
    models.find((model) => model.id === choice.model)?.efforts ??
    GENERIC_EFFORTS.map((value) => ({ value, label: value }))
  const fromRun = request.fromRun ?? goal.viewer.latestRun
  const needsModelPick = request.mode === 'continue-on' || request.mode === 'work-myself'
  const itemPath = request.mode === 'continue-on' ? undefined : (nextItem?.path ?? undefined)
  const workspaceNote =
    request.mode === 'continue-on'
      ? 'Same workspace as the goal; the session links to the run as its child (§3e.3).'
      : nextItem
        ? nextItem.workspace === 'new-worktree'
          ? `Code item: opens in a new worktree (${nextItem.stage}).`
          : `Ops/data item: opens in the existing project workspace (${nextItem.stage}).`
        : 'Looking for a ready item…'

  const submit = (): void => {
    if (!window.api.xosGoals) {
      return
    }
    setPending(true)
    void window.api.xosGoals
      .continueOn({
        projectKey: request.project.key,
        goal: goal.goal,
        agent,
        model: needsModelPick ? choice.model : null,
        effort: needsModelPick ? choice.effort : null,
        mode: request.mode === 'build-now' ? 'build' : 'takeover',
        itemPath,
        ...(message.trim() ? { message: message.trim() } : {}),
        ...(withContext && fromRun?.started_at ? { fromStartedAt: fromRun.started_at } : {})
      })
      .then((result) => {
        if (result.ok) {
          toast.success(result.message)
          onClose()
        } else {
          toast.error(result.error)
        }
      })
      .finally(() => setPending(false))
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">Agent</span>
              <Select
                value={agent}
                onValueChange={(value) => setAgent(isTuiAgent(value) ? value : 'claude')}
              >
                <SelectTrigger className="w-full" aria-label="Agent">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {agentOptions(goal).map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            {needsModelPick && xosModelArgsSupported(agent) && (
              <label className="space-y-1 text-xs">
                <span className="text-muted-foreground">Model</span>
                <Select
                  value={choice.model ?? '__default__'}
                  onValueChange={(value) =>
                    setChoice((current) => ({
                      model: value === '__default__' ? null : value,
                      effort: current.effort
                    }))
                  }
                >
                  <SelectTrigger className="w-full" aria-label="Model">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">Agent default</SelectItem>
                    {models.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.label}
                        {model.isDefault ? ' (default)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            )}
          </div>
          {needsModelPick && xosAgentTakesEffort(agent) && (
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">Reasoning effort</span>
              <Select
                value={choice.effort ?? '__default__'}
                onValueChange={(value) =>
                  setChoice((current) => ({
                    ...current,
                    effort: value === '__default__' ? null : value
                  }))
                }
              >
                <SelectTrigger className="w-full" aria-label="Reasoning effort">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">Default</SelectItem>
                  {efforts.map((effort) => (
                    <SelectItem key={effort.value} value={effort.value}>
                      {effort.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          )}
          {request.mode === 'continue-on' && fromRun && (
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={withContext}
                onChange={(event) => setWithContext(event.target.checked)}
                className="size-3.5"
              />
              <span className="text-muted-foreground">
                Include the latest run ({fromRun.started_at ?? 'unknown start'}) as takeover context
              </span>
            </label>
          )}
          {request.mode !== 'continue-on' && (
            <p className="rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
              {nextItem ? (
                <>
                  <span className="font-semibold text-foreground">{nextItem.title}</span>
                  {' · '}
                  {nextItem.stage}
                  <br />
                </>
              ) : (
                <>No eligible ready item in the input queues right now.</>
              )}
              {workspaceNote}
            </p>
          )}
          <Input
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Extra instruction for this session (optional)…"
            aria-label="Operator message"
          />
          {request.mode === 'build-now' && liveTail && (
            <div className="rounded-md border bg-muted/30 p-2">
              <LiveRunStatusChip tail={liveTail} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={pending || (request.mode !== 'continue-on' && !nextItem)}
            onClick={submit}
          >
            {copy.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
