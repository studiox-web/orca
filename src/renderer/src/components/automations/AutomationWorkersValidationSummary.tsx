import React from 'react'
import { AlertCircle, ArrowRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { CoordinatedAutomationValidationError } from '../../../../shared/coordinated-automation-validation'
import { translate } from '@/i18n/i18n'

type AutomationWorkersValidationSummaryProps = {
  errors: readonly CoordinatedAutomationValidationError[]
  onSelectChild?: (childId: string) => void
  className?: string
}

function formatErrorCode(code: string): string {
  return code
    .replace(/^INVALID_COORDINATED_/, '')
    .replace(/_/g, ' ')
    .toLowerCase()
}

export function AutomationWorkersValidationSummary({
  errors,
  onSelectChild,
  className = ''
}: AutomationWorkersValidationSummaryProps): React.JSX.Element | null {
  if (errors.length === 0) {
    return null
  }

  return (
    <div
      role="alert"
      className={`@container rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-destructive dark:border-destructive/50 dark:bg-destructive/15 ${className}`}
      data-testid="automation-workers-validation-summary"
    >
      <div className="flex items-center gap-2 font-medium text-sm">
        <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
        <span>
          {translate(
            'auto.components.automations.workers.validationSummaryTitle',
            'Definition validation issues ({{count}})',
            { count: errors.length, defaultValue_one: 'Definition validation issue (1)' }
          )}
        </span>
      </div>

      <ul className="mt-2 space-y-1.5 text-xs">
        {errors.map((error, index) => {
          const key = `${error.code}-${error.childId ?? 'global'}-${index}`
          return (
            <li
              key={key}
              className="flex flex-col @md:flex-row @md:items-center justify-between gap-2 rounded bg-background/50 px-2.5 py-2 text-foreground"
            >
              <div className="flex min-w-0 items-start gap-2">
                <Badge
                  variant="outline"
                  className="mt-0.5 shrink-0 border-destructive/40 text-destructive text-3xs uppercase tracking-wider"
                >
                  {formatErrorCode(error.code)}
                </Badge>
                <div className="min-w-0">
                  <p className="break-words font-normal text-xs text-foreground">{error.message}</p>
                  {error.path ? (
                    <p className="font-mono text-3xs text-muted-foreground break-words">
                      {error.path}
                    </p>
                  ) : null}
                </div>
              </div>

              {error.childId && onSelectChild ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 shrink-0 self-start @md:self-center gap-1 px-1.5 text-2xs text-muted-foreground hover:text-foreground"
                  onClick={() => onSelectChild(error.childId!)}
                  aria-label={translate(
                    'auto.components.automations.workers.jumpToChild',
                    'Jump to worker {{id}}',
                    { id: error.childId }
                  )}
                >
                  <span>{error.childId}</span>
                  <ArrowRight className="size-3" />
                </Button>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
