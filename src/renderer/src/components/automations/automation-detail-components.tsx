import React from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'

export function DetailMetric({
  label,
  value,
  title
}: {
  label: string
  value: string
  title?: string
}): React.JSX.Element {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-sm font-medium" title={title}>
        {value}
      </div>
    </div>
  )
}

export function formatGrace(minutes: number): string {
  if (minutes <= 0) {
    return translate('auto.components.automations.AutomationDetail.noGrace', 'No grace')
  }
  if (minutes < 60) {
    return translate(
      'auto.components.automations.AutomationDetail.graceMinutes',
      '{{count}} minutes',
      { count: minutes, defaultValue_one: '{{count}} minute' }
    )
  }
  const hours = minutes / 60
  return translate('auto.components.automations.AutomationDetail.graceHours', '{{count}} hours', {
    count: hours,
    defaultValue_one: '{{count}} hour'
  })
}

export function ToolbarIconButton({
  label,
  children,
  onClick,
  className
}: {
  label: string
  children: React.ReactNode
  onClick?: () => void
  className?: string
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          onClick={onClick}
          className={className}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export function CoordinatedFlagOffBanner(): React.JSX.Element {
  return (
    <div
      role="status"
      data-testid="coordinated-flag-off-banner"
      className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning-foreground shadow-sm"
    >
      {translate(
        'auto.components.automations.detail.coordinatedFlagOffNotice',
        'This coordinated automation is displayed in safe read-only mode because the experimental feature flag is disabled in Settings. Execution and editing controls are unavailable.'
      )}
    </div>
  )
}
