// XOS fork: an automation's model chain on its detail page (plan §3.2 "Fallbacks", RT5/RT6): the
// primary model from its arguments, the ordered fallbacks tried when a run hits a usage limit, and
// the recent runs with the model each one used and how it ended.
import React, { useCallback, useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { Automation } from '../../../../shared/automations-types'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { TUI_AGENT_DISPLAY_NAMES } from '../../../../shared/tui-agent-display-names'
import { readXosModelArgs, xosModelArgsSupported } from '../../../../shared/xos-model-args'
import type {
  XosAutomationRunConfig,
  XosModelChoice,
  XosRunAttempt
} from '../../../../shared/xos-runtime-types'
import type { AutomationDraft } from '../automations/AutomationEditorDialog'
import { XosAutomationModelField } from './XosAutomationModelField'
import { relativeTime } from './xos-format'
import './xos-ops-cards.css'

const AGENTS = (Object.keys(TUI_AGENT_DISPLAY_NAMES) as TuiAgent[]).filter(xosModelArgsSupported)

function label(choice: XosModelChoice): string {
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

function AddFallback({ onAdd }: { onAdd: (choice: XosModelChoice) => void }): React.JSX.Element {
  const [draft, setDraft] = useState({ agentId: 'codex', extraAgentArgs: '' } as AutomationDraft)
  return (
    <div className="space-y-2 rounded-md border border-dashed p-3">
      <Select
        value={draft.agentId}
        onValueChange={(agentId) =>
          setDraft((current) => ({ ...current, agentId: agentId as TuiAgent, extraAgentArgs: '' }))
        }
      >
        <SelectTrigger size="sm" className="w-full" aria-label="Fallback agent">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {AGENTS.map((agent) => (
            <SelectItem key={agent} value={agent}>
              {TUI_AGENT_DISPLAY_NAMES[agent]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <XosAutomationModelField draft={draft} onDraftChange={(update) => setDraft(update)} />
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => {
          const { model, effort } = readXosModelArgs(draft.agentId, draft.extraAgentArgs)
          onAdd({ agent: draft.agentId, model, effort })
          setDraft((current) => ({ ...current, extraAgentArgs: '' }))
        }}
      >
        <Plus className="size-3.5" />
        Add fallback
      </Button>
    </div>
  )
}

function AttemptRow({ attempt }: { attempt: XosRunAttempt }): React.JSX.Element {
  const outcome = attempt.outcome ? OUTCOME[attempt.outcome.kind] : null
  return (
    <li className="flex items-center gap-2 text-xs">
      <span className="w-16 shrink-0 text-muted-foreground">{relativeTime(attempt.at)}</span>
      <span className="min-w-0 flex-1 truncate" title={attempt.reason ?? undefined}>
        {attempt.attempt > 0 ? `↳ fallback ${attempt.attempt}: ` : ''}
        {label(attempt)}
      </span>
      <span
        className={`shrink-0 rounded-full border px-1.5 ${outcome?.tone ?? 'xos-tone-neutral'}`}
        title={attempt.outcome?.detail ?? undefined}
      >
        {outcome?.text ?? 'running'}
      </span>
    </li>
  )
}

export function XosAutomationFallbacks({
  automation
}: {
  automation: Automation
}): React.JSX.Element | null {
  const api = window.api?.xosGoals
  const [config, setConfig] = useState<XosAutomationRunConfig | null>(null)
  const [attempts, setAttempts] = useState<XosRunAttempt[]>([])
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    if (!api) {
      return
    }
    const [nextConfig, nextAttempts] = await Promise.all([
      api.getRunConfig({ automationId: automation.id }),
      api.getRunAttempts({ automationId: automation.id, limit: 8 })
    ])
    setConfig(nextConfig)
    setAttempts(nextAttempts)
  }, [api, automation.id])

  useEffect(() => {
    void load()
  }, [load, automation.lastRunAt])

  if (!api || !config) {
    return null
  }

  const save = async (next: XosAutomationRunConfig): Promise<void> => {
    setConfig(next)
    const result = await api.setRunConfig({ automationId: automation.id, config: next })
    if (!result.ok) {
      toast.error(result.error)
      void load()
    }
  }
  const move = (index: number, delta: number): void => {
    const fallbacks = [...config.fallbacks]
    const [entry] = fallbacks.splice(index, 1)
    fallbacks.splice(index + delta, 0, entry)
    void save({ ...config, fallbacks })
  }
  const { model, effort } = readXosModelArgs(automation.agentId, automation.extraAgentArgs ?? '')
  // Stable keys for a reorderable list that may hold the same model twice.
  const seen = new Map<string, number>()
  const fallbackKeys = config.fallbacks.map((choice) => {
    const text = label(choice)
    const count = (seen.get(text) ?? 0) + 1
    seen.set(text, count)
    return `${text}#${count}`
  })

  return (
    <section className="space-y-3 rounded-md border border-border/50 bg-muted/20 px-4 py-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-medium uppercase text-muted-foreground">
          Model and fallbacks
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Also on manual runs
          <Switch
            checked={config.fallbackOnManualRuns}
            onCheckedChange={(checked) => void save({ ...config, fallbackOnManualRuns: checked })}
          />
        </label>
      </div>
      {automation.surface === 'chat' && (
        <p className="text-xs text-muted-foreground">
          Fallback works for terminal runs. Chat runs keep using their agent&apos;s chat model.
        </p>
      )}
      <ol className="space-y-1.5 text-sm">
        <li className="flex items-center gap-2">
          <span className="w-5 text-xs text-muted-foreground">1.</span>
          <span className="min-w-0 flex-1 truncate font-medium">
            {label({ agent: automation.agentId, model, effort })}
          </span>
          <span className="text-xs text-muted-foreground">primary</span>
        </li>
        {config.fallbacks.map((choice, index) => (
          <li key={fallbackKeys[index]} className="flex items-center gap-2">
            <span className="w-5 text-xs text-muted-foreground">{index + 2}.</span>
            <span className="min-w-0 flex-1 truncate">{label(choice)}</span>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="Move up"
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              <ArrowUp className="size-3" />
            </Button>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="Move down"
              disabled={index === config.fallbacks.length - 1}
              onClick={() => move(index, 1)}
            >
              <ArrowDown className="size-3" />
            </Button>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="Remove fallback"
              onClick={() =>
                void save({ ...config, fallbacks: config.fallbacks.filter((_, i) => i !== index) })
              }
            >
              <X className="size-3" />
            </Button>
          </li>
        ))}
      </ol>
      {adding ? (
        <AddFallback
          onAdd={(choice) => {
            setAdding(false)
            void save({ ...config, fallbacks: [...config.fallbacks, choice] })
          }}
        />
      ) : (
        config.fallbacks.length < 5 && (
          <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" />
            Add fallback model
          </Button>
        )
      )}
      <p className="text-xs text-muted-foreground">
        When a run stops on a usage limit, overload, sign-in problem or missing agent, Orca starts
        it again on the next model. Other failures never fall back.
      </p>
      {attempts.length > 0 && (
        <ul className="space-y-1 border-t pt-2">
          {attempts.map((attempt) => (
            <AttemptRow key={attempt.runId} attempt={attempt} />
          ))}
        </ul>
      )}
    </section>
  )
}
