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
  disabled,
  className
}: {
  label: string
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  className?: string
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          disabled={disabled}
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
      className="rounded-md border border-status-warning-border bg-status-warning-background p-3 text-xs text-status-warning-text shadow-sm"
    >
      {translate(
        'auto.components.automations.detail.coordinatedFlagOffNotice',
        'This coordinated automation is displayed in safe read-only mode because the experimental feature flag is disabled in Settings. Execution and editing controls are unavailable.'
      )}
    </div>
  )
}

export function focusConfiguredWorkerCard(childId: string): void {
  const el = document.getElementById(`worker-card-${childId}`)
  el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  el?.focus()
}

export function getAutomationToolbarLabels(input: {
  isFlagOffCoordinated: boolean
  enabled: boolean
}): { editLabel: string; toggleLabel: string } {
  const editLabel = input.isFlagOffCoordinated
    ? translate(
        'auto.components.automations.detail.editDisabledFlagOff',
        'Coordinated automation editing disabled while feature flag is off'
      )
    : translate('auto.components.automations.AutomationDetail.4b1ea02d2e', 'Edit automation')
  const toggleLabel = input.isFlagOffCoordinated
    ? translate(
        'auto.components.automations.detail.toggleDisabledFlagOff',
        'Coordinated automation state changes disabled while feature flag is off'
      )
    : input.enabled
      ? translate('auto.components.automations.AutomationDetail.91a4155e95', 'Pause automation')
      : translate('auto.components.automations.AutomationDetail.d79452fb30', 'Resume automation')
  return { editLabel, toggleLabel }
}
