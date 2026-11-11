// XOS fork: Model + Effort pickers in the automation editor (plan §3.2, RT1/RT2). The choice is
// written into the automation's extra agent arguments, which upstream already saves, validates and
// applies on every run; this field is only a structured view over those flags.
import React, { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { TuiAgent } from '../../../../shared/tui-agent'
import type { XosModelList } from '../../../../shared/xos-runtime-types'
import {
  readXosModelArgs,
  writeXosModelArgs,
  xosAgentTakesEffort,
  xosModelArgsSupported,
  type XosModelArgs
} from '../../../../shared/xos-model-args'
import { AUTOMATION_EDITOR_SECTION_LABEL_CLASS } from '../automations/automation-page-parts'
import type { AutomationDraft } from '../automations/AutomationEditorDialog'

const DEFAULT = '__default'
const CUSTOM = '__custom'
const GENERIC_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

const cache = new Map<string, Promise<XosModelList>>()

function loadModels(agent: string, refresh: boolean): Promise<XosModelList> {
  const api = window.api?.xosGoals
  if (!api) {
    return Promise.resolve({ status: 'unavailable', message: 'Not available in this build.' })
  }
  if (refresh || !cache.has(agent)) {
    const request = api.listModels({ agent })
    cache.set(agent, request)
    // A failed or empty answer is retried next time instead of being remembered.
    void request.then((result) => result.status !== 'ok' && cache.delete(agent))
  }
  return cache.get(agent)!
}

export function XosAutomationModelField({
  draft,
  onDraftChange
}: {
  draft: AutomationDraft
  onDraftChange: (updater: (current: AutomationDraft) => AutomationDraft) => void
}): React.JSX.Element | null {
  const agent = draft.agentId as TuiAgent
  const [list, setList] = useState<XosModelList | null>(null)
  const [custom, setCustom] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (!xosModelArgsSupported(agent)) {
      return
    }
    let cancelled = false
    setList(null)
    void loadModels(agent, refreshKey > 0).then((result) => !cancelled && setList(result))
    return () => {
      cancelled = true
    }
  }, [agent, refreshKey])

  if (!window.api?.xosGoals) {
    return null
  }
  if (!xosModelArgsSupported(agent)) {
    return (
      <div>
        <div className={AUTOMATION_EDITOR_SECTION_LABEL_CLASS}>Model</div>
        <p className="mt-2 text-xs text-muted-foreground">
          This agent always runs its own default model.
        </p>
      </div>
    )
  }

  const current = readXosModelArgs(agent, draft.extraAgentArgs)
  const unreadable = writeXosModelArgs(agent, draft.extraAgentArgs, current) === null
  const models = list?.status === 'ok' ? list.models : []
  const selected = models.find((model) => model.id === current.model) ?? null
  const showCustom = custom || (current.model !== null && list?.status === 'ok' && !selected)
  const efforts = selected?.efforts.length
    ? selected.efforts
    : GENERIC_EFFORTS.map((value) => ({ value, label: value }))

  const write = (choice: XosModelArgs): void =>
    onDraftChange((draftNow) => {
      const next = writeXosModelArgs(agent, draftNow.extraAgentArgs, choice)
      return next === null ? draftNow : { ...draftNow, extraAgentArgs: next }
    })

  const modelValue = showCustom ? CUSTOM : (current.model ?? DEFAULT)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className={AUTOMATION_EDITOR_SECTION_LABEL_CLASS}>Model</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Refresh the model list"
          onClick={() => setRefreshKey((key) => key + 1)}
        >
          <RefreshCw className={list === null ? 'size-3 animate-spin' : 'size-3'} />
        </Button>
      </div>
      {unreadable ? (
        <p className="text-xs text-muted-foreground">
          Fix the extra agent arguments below to pick a model here.
        </p>
      ) : (
        <>
          <Select
            value={modelValue}
            onValueChange={(value) => {
              if (value === CUSTOM) {
                setCustom(true)
                return
              }
              setCustom(false)
              const model = value === DEFAULT ? null : value
              const nextEfforts = models.find((entry) => entry.id === model)?.efforts
              const keepEffort =
                current.effort &&
                (!nextEfforts?.length || nextEfforts.some((e) => e.value === current.effort))
              write({ model, effort: keepEffort ? current.effort : null })
            }}
          >
            <SelectTrigger size="sm" className="w-full" aria-label="Model">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT}>Agent default</SelectItem>
              {models.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.label}
                  {model.isDefault ? ' (default)' : ''}
                </SelectItem>
              ))}
              <SelectItem value={CUSTOM}>Other model id…</SelectItem>
            </SelectContent>
          </Select>
          {showCustom && (
            <Input
              key={current.model ?? ''}
              id="xos-automation-model-id"
              name="xos-automation-model-id"
              variant="code"
              placeholder="Model id, e.g. opus or gpt-5.5"
              defaultValue={current.model ?? ''}
              onBlur={(event) =>
                write({ model: event.target.value.trim() || null, effort: current.effort })
              }
            />
          )}
          {xosAgentTakesEffort(agent) && (
            <Select
              value={current.effort ?? DEFAULT}
              onValueChange={(value) =>
                write({ model: current.model, effort: value === DEFAULT ? null : value })
              }
            >
              <SelectTrigger size="sm" className="w-full" aria-label="Reasoning effort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT}>
                  Default effort{selected?.defaultEffort ? ` (${selected.defaultEffort})` : ''}
                </SelectItem>
                {efforts.map((effort) => (
                  <SelectItem key={effort.value} value={effort.value}>
                    {effort.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {list?.status === 'unavailable' && (
            <p className="text-xs text-muted-foreground">
              {list.message} You can still type a model id.
            </p>
          )}
        </>
      )}
    </div>
  )
}
