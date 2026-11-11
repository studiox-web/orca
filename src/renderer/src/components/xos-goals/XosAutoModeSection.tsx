// XOS fork: Auto mode settings (plan §3.3): tier, allowed agents, quota reserve and effort, what Auto
// would pick right now, and the editable tier map for the allowed agents' catalog models.
import React, { useState } from 'react'
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
import { Switch } from '@/components/ui/switch'
import { Toggle } from '@/components/ui/toggle'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { TUI_AGENT_DISPLAY_NAMES } from '../../../../shared/tui-agent-display-names'
import { xosModelArgsSupported } from '../../../../shared/xos-model-args'
import type {
  XosAutoModeConfig,
  XosAutoPreview,
  XosAutomationRunConfig,
  XosModelTier,
  XosTierModel
} from '../../../../shared/xos-runtime-types'
import { choiceLabel } from './XosRunHistory'

const AGENTS = (Object.keys(TUI_AGENT_DISPLAY_NAMES) as TuiAgent[]).filter(xosModelArgsSupported)
const TIERS: XosModelTier[] = ['high', 'standard', 'light']
const DEFAULT_AUTO: XosAutoModeConfig = {
  tier: 'standard',
  providers: ['claude', 'codex'],
  reservePercent: 10,
  effort: null
}

function TierMap({ agents }: { agents: string[] }): React.JSX.Element {
  const api = window.api?.xosGoals
  const [models, setModels] = useState<XosTierModel[] | null>(null)
  const load = (): void => {
    void api?.getTierModels({ agents }).then(setModels)
  }
  if (!models) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={load}>
        Edit tier map
      </Button>
    )
  }
  return (
    <ul className="max-h-64 space-y-1 overflow-y-auto scrollbar-sleek rounded-md border p-2 text-xs">
      {models.length === 0 && <li className="text-muted-foreground">No model lists yet.</li>}
      {models.map((entry) => (
        <li key={`${entry.agent}:${entry.model}`} className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate">
            {choiceLabel({ agent: entry.agent, model: entry.label, effort: null })}
          </span>
          {!entry.tier && (
            <span className="xos-tone-warning rounded-full border px-1.5">unassigned</span>
          )}
          <Select
            value={entry.tier ?? 'none'}
            onValueChange={(value) => {
              const tier = value === 'none' ? null : (value as XosModelTier)
              void api?.setModelTier({ agent: entry.agent, model: entry.model, tier }).then(load)
            }}
          >
            <SelectTrigger size="sm" className="w-28" aria-label={`Tier of ${entry.label}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIERS.map((tier) => (
                <SelectItem key={tier} value={tier}>
                  {tier}
                </SelectItem>
              ))}
              <SelectItem value="none">not used</SelectItem>
            </SelectContent>
          </Select>
        </li>
      ))}
    </ul>
  )
}

export function XosAutoModeSection({
  config,
  onSave
}: {
  config: XosAutomationRunConfig
  onSave: (next: XosAutomationRunConfig) => void
}): React.JSX.Element {
  const api = window.api?.xosGoals
  const [preview, setPreview] = useState<XosAutoPreview | null>(null)
  const [checking, setChecking] = useState(false)
  const auto = config.auto
  const update = (patch: Partial<XosAutoModeConfig>): void => {
    setPreview(null)
    onSave({ ...config, auto: { ...(auto ?? DEFAULT_AUTO), ...patch } })
  }
  const check = async (): Promise<void> => {
    if (!api || !auto) {
      return
    }
    setChecking(true)
    try {
      setPreview(await api.previewAuto({ auto }))
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="space-y-2 border-t pt-3">
      <label className="flex items-center justify-between gap-2 text-xs font-medium">
        Auto: pick the model with the most quota left
        <Switch
          checked={auto !== null}
          onCheckedChange={(checked) => (checked ? update({}) : onSave({ ...config, auto: null }))}
        />
      </label>
      {auto && (
        <>
          <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
            <label className="space-y-1">
              <span>Tier</span>
              <Select
                value={auto.tier}
                onValueChange={(tier) => update({ tier: tier as XosModelTier })}
              >
                <SelectTrigger size="sm" className="w-full" aria-label="Tier">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIERS.map((tier) => (
                    <SelectItem key={tier} value={tier}>
                      {tier}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1">
              <span>Effort</span>
              <Select
                value={auto.effort ?? 'default'}
                onValueChange={(effort) => update({ effort: effort === 'default' ? null : effort })}
              >
                <SelectTrigger size="sm" className="w-full" aria-label="Effort">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Model default</SelectItem>
                  {['low', 'medium', 'high'].map((effort) => (
                    <SelectItem key={effort} value={effort}>
                      {effort}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label htmlFor="xos-auto-reserve" className="space-y-1">
              <span>Weekly reserve %</span>
              <Input
                key={auto.reservePercent}
                id="xos-auto-reserve"
                name="xos-auto-reserve"
                type="number"
                min={0}
                max={50}
                defaultValue={auto.reservePercent}
                onBlur={(event) => update({ reservePercent: Number(event.target.value) || 0 })}
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Allowed agents">
            {AGENTS.map((agent) => (
              <Toggle
                key={agent}
                size="sm"
                variant="outline"
                pressed={auto.providers.includes(agent)}
                onPressedChange={(pressed) => {
                  const providers = pressed
                    ? [...auto.providers, agent]
                    : auto.providers.filter((entry) => entry !== agent)
                  if (providers.length > 0) {
                    update({ providers })
                  }
                }}
              >
                {TUI_AGENT_DISPLAY_NAMES[agent]}
              </Toggle>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={checking}
              onClick={() => void check()}
            >
              <RefreshCw className={checking ? 'size-3.5 animate-spin' : 'size-3.5'} />
              What would Auto pick now?
            </Button>
            <TierMap agents={auto.providers} />
          </div>
          {preview && (
            <div className="space-y-1 rounded-md border p-2 text-xs">
              <div className="font-medium">{preview.reason}</div>
              <ol className="space-y-0.5 text-muted-foreground">
                {preview.candidates.map((candidate) => (
                  <li
                    key={choiceLabel(candidate.choice)}
                    className={candidate.available ? '' : 'line-through'}
                  >
                    {choiceLabel(candidate.choice)} — {candidate.quota}
                  </li>
                ))}
              </ol>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Each run uses the allowed model of this tier whose quota has the most left before it
            resets; agents earlier in the list win ties. The rest of the ranking, then the fallbacks
            above, are tried on a usage limit.
          </p>
        </>
      )}
    </div>
  )
}
