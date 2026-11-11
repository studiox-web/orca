import React from 'react'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import type { CoordinatedAutomationInheritedDefaults } from '../../../../shared/coordinated-automation-types'
import { translate } from '@/i18n/i18n'
import type { LaunchConfigFormState } from './AutomationWorkerLaunchConfigFields'

type AutomationWorkerExecutionPolicyFieldsProps = {
  state: LaunchConfigFormState
  onChange: React.Dispatch<React.SetStateAction<LaunchConfigFormState>>
  parentDefaults?: CoordinatedAutomationInheritedDefaults
}

export function AutomationWorkerExecutionPolicyFields({
  state,
  onChange,
  parentDefaults
}: AutomationWorkerExecutionPolicyFieldsProps): React.JSX.Element {
  return (
    <div className="space-y-3 border-t border-border/40 pt-2">
      {/* Timeout */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-2xs text-muted-foreground">
            {translate('auto.components.automations.workers.overrideTimeout', 'Override timeout')}
          </span>
          <Switch
            checked={state.overrideTimeout}
            onCheckedChange={(val) => onChange((prev) => ({ ...prev, overrideTimeout: val }))}
            aria-label={translate(
              'auto.components.automations.workers.overrideTimeout',
              'Override timeout'
            )}
          />
        </div>
        {state.overrideTimeout ? (
          <div className="flex items-center gap-2">
            <Input
              id="worker-timeout-override-input"
              type="number"
              min="1"
              value={state.timeoutMinutes}
              onChange={(e) => {
                const val = e.target.value
                onChange((prev) => ({ ...prev, timeoutMinutes: val }))
              }}
              placeholder="30"
              aria-label={translate(
                'auto.components.automations.workers.timeoutInputLabel',
                'Timeout override in minutes'
              )}
            />
            <span className="text-2xs text-muted-foreground">
              {translate(
                'auto.components.automations.AutomationWorkerExecutionPolicyFields.1a7159efdd',
                'min'
              )}
            </span>
          </div>
        ) : (
          <div className="text-2xs text-muted-foreground italic">
            {typeof parentDefaults?.timeoutSeconds === 'number' && parentDefaults.timeoutSeconds > 0
              ? translate(
                  'auto.components.automations.workers.inheritingTimeout',
                  'Inheriting parent default timeout ({{minutes}}m)',
                  { minutes: Math.round(parentDefaults.timeoutSeconds / 60) }
                )
              : translate(
                  'auto.components.automations.workers.inheritingTimeoutDefault',
                  'Inherited (default)'
                )}
          </div>
        )}
      </div>

      {/* Retries & Review Iterations */}
      <div className="grid grid-cols-1 gap-2 border-t border-border/40 pt-2 sm:grid-cols-2">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-2xs text-muted-foreground">
              {translate('auto.components.automations.workers.overrideRetries', 'Max retries')}
            </span>
            <Switch
              checked={state.overrideRetries}
              onCheckedChange={(val) => onChange((prev) => ({ ...prev, overrideRetries: val }))}
              aria-label={translate(
                'auto.components.automations.workers.overrideRetries',
                'Max retries'
              )}
            />
          </div>
          {state.overrideRetries ? (
            <Input
              density="compact"
              id="worker-retries-override-input"
              type="number"
              min="0"
              max="50"
              value={state.maxRetries}
              onChange={(e) => {
                const val = e.target.value
                onChange((prev) => ({ ...prev, maxRetries: val }))
              }}
              placeholder="3"
              aria-label={translate(
                'auto.components.automations.workers.retriesInputLabel',
                'Max retries override'
              )}
            />
          ) : (
            <div className="text-2xs text-muted-foreground italic">
              {typeof parentDefaults?.maxRetries === 'number'
                ? translate(
                    'auto.components.automations.workers.inheritingRetries',
                    'Inheriting ({{count}})',
                    { count: parentDefaults.maxRetries }
                  )
                : translate(
                    'auto.components.automations.workers.inheritingRetriesDefault',
                    'Inherited (default)'
                  )}
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-2xs text-muted-foreground">
              {translate(
                'auto.components.automations.workers.overrideReviews',
                'Review iterations'
              )}
            </span>
            <Switch
              checked={state.overrideReviewIterations}
              onCheckedChange={(val) =>
                onChange((prev) => ({ ...prev, overrideReviewIterations: val }))
              }
              aria-label={translate(
                'auto.components.automations.workers.overrideReviews',
                'Review iterations'
              )}
            />
          </div>
          {state.overrideReviewIterations ? (
            <Input
              density="compact"
              id="worker-reviews-override-input"
              type="number"
              min="0"
              max="50"
              value={state.maxReviewIterations}
              onChange={(e) => {
                const val = e.target.value
                onChange((prev) => ({ ...prev, maxReviewIterations: val }))
              }}
              placeholder="2"
              aria-label={translate(
                'auto.components.automations.workers.reviewsInputLabel',
                'Max review iterations override'
              )}
            />
          ) : (
            <div className="text-2xs text-muted-foreground italic">
              {typeof parentDefaults?.maxReviewIterations === 'number'
                ? translate(
                    'auto.components.automations.workers.inheritingReviews',
                    'Inheriting ({{count}})',
                    { count: parentDefaults.maxReviewIterations }
                  )
                : translate(
                    'auto.components.automations.workers.inheritingReviewsDefault',
                    'Inherited (default)'
                  )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
