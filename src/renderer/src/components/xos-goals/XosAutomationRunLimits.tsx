// XOS fork: lane lock (RT7) and run timeout (RT15) settings on an automation's detail page.
import React from 'react'
import { Input } from '@/components/ui/input'
import type { XosAutomationRunConfig } from '../../../../shared/xos-runtime-types'

function NumberField({
  id,
  label,
  value,
  placeholder,
  onCommit
}: {
  id: string
  label: string
  value: number | null
  placeholder: string
  onCommit: (value: number) => void
}): React.JSX.Element {
  return (
    <label htmlFor={id} className="space-y-1 text-xs text-muted-foreground">
      <span>{label}</span>
      <Input
        key={String(value)}
        id={id}
        name={id}
        type="number"
        min={0}
        inputMode="numeric"
        placeholder={placeholder}
        defaultValue={value ?? ''}
        onBlur={(event) => onCommit(Number(event.target.value) || 0)}
      />
    </label>
  )
}

export function XosAutomationRunLimits({
  config,
  onSave
}: {
  config: XosAutomationRunConfig
  onSave: (next: XosAutomationRunConfig) => void
}): React.JSX.Element {
  return (
    <div className="space-y-2 border-t pt-3">
      <div className="grid grid-cols-3 gap-2">
        <label htmlFor="xos-lock-lane" className="space-y-1 text-xs text-muted-foreground">
          <span>Lock lane</span>
          <Input
            key={config.lockLane ?? ''}
            id="xos-lock-lane"
            name="xos-lock-lane"
            variant="code"
            placeholder="none"
            defaultValue={config.lockLane ?? ''}
            onBlur={(event) =>
              onSave({ ...config, lockLane: event.target.value.trim().toLowerCase() || null })
            }
          />
        </label>
        <NumberField
          id="xos-lock-wait"
          label="Wait for lane (min)"
          value={config.lockWaitMinutes || null}
          placeholder="0 = skip"
          onCommit={(minutes) => onSave({ ...config, lockWaitMinutes: minutes })}
        />
        <NumberField
          id="xos-timeout"
          label="Timeout (min)"
          value={config.timeoutMinutes}
          placeholder="none"
          onCommit={(minutes) =>
            onSave({ ...config, timeoutMinutes: minutes > 0 ? minutes : null })
          }
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Runs in one lane of a project never overlap, also with crontab goals in that lane (for
        example <code>repo-mutating</code> or <code>content</code>). A busy lane skips the run, or
        queues it when a wait is set. A run still going at its timeout is stopped.
      </p>
    </div>
  )
}
