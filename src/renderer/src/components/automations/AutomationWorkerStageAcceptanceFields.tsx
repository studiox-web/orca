import React, { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { StageAcceptanceContract } from '../../../../shared/coordinated-automation-types'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { translate } from '@/i18n/i18n'

const EMPTY_STAGE_ACCEPTANCE: StageAcceptanceContract = {}

type AutomationWorkerStageAcceptanceFieldsProps = {
  stageAcceptance?: StageAcceptanceContract
  onChange: (stageAcceptance: StageAcceptanceContract) => void
}

export function AutomationWorkerStageAcceptanceFields({
  stageAcceptance = EMPTY_STAGE_ACCEPTANCE,
  onChange
}: AutomationWorkerStageAcceptanceFieldsProps): React.JSX.Element {
  const [newCriterion, setNewCriterion] = useState('')
  const [newCheck, setNewCheck] = useState('')

  const criteria = stageAcceptance.criteria ?? []
  const requiredChecks = stageAcceptance.requiredChecks ?? []

  const handleAddCriterion = (): void => {
    if (!newCriterion.trim()) {
      return
    }
    onChange({
      ...stageAcceptance,
      criteria: [
        ...criteria,
        { id: createBrowserUuid(), description: newCriterion.trim(), required: true }
      ]
    })
    setNewCriterion('')
  }

  const handleRemoveCriterion = (index: number): void => {
    onChange({
      ...stageAcceptance,
      criteria: criteria.filter((_, i) => i !== index)
    })
  }

  const handleAddCheck = (): void => {
    if (!newCheck.trim()) {
      return
    }
    onChange({
      ...stageAcceptance,
      requiredChecks: [
        ...requiredChecks,
        { id: createBrowserUuid(), description: newCheck.trim(), required: true }
      ]
    })
    setNewCheck('')
  }

  const handleRemoveCheck = (index: number): void => {
    onChange({
      ...stageAcceptance,
      requiredChecks: requiredChecks.filter((_, i) => i !== index)
    })
  }

  return (
    <div className="space-y-3 rounded-md border border-border/50 p-3">
      <Label className="font-semibold text-xs">
        {translate('auto.components.automations.workers.stageAcceptanceTitle', 'Stage Acceptance')}
      </Label>

      {/* Criteria */}
      <div className="space-y-1.5">
        <span className="text-2xs text-muted-foreground font-medium">
          {translate(
            'auto.components.automations.workers.acceptanceCriteriaTitle',
            'Acceptance Criteria'
          )}
        </span>
        <div className="space-y-1">
          {criteria.map((crit, idx) => (
            <div
              key={crit.id ?? idx}
              className="flex items-center justify-between gap-2 rounded bg-muted/30 px-2 py-1 text-2xs"
            >
              <span className="truncate">{crit.description}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="h-4 w-4 text-destructive"
                onClick={() => handleRemoveCriterion(idx)}
                aria-label={translate(
                  'auto.components.automations.workers.removeCriterion',
                  'Remove criterion: {{description}}',
                  { description: crit.description }
                )}
              >
                <Trash2 className="size-2.5" />
              </Button>
            </div>
          ))}
          <div className="flex items-center gap-1.5 pt-1">
            <Input
              id="worker-new-criterion-input"
              value={newCriterion}
              onChange={(e) => setNewCriterion(e.target.value)}
              placeholder="e.g. Validated schema and zero lint warnings"
              aria-label={translate(
                'auto.components.automations.workers.newCriterionLabel',
                'New acceptance criterion'
              )}
              className="text-xs h-7"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-2xs"
              onClick={handleAddCriterion}
            >
              <Plus className="size-3 mr-1" />
              {translate('auto.components.automations.workers.add', 'Add')}
            </Button>
          </div>
        </div>
      </div>

      {/* Required checks */}
      <div className="space-y-1.5 border-t border-border/40 pt-2">
        <span className="text-2xs text-muted-foreground font-medium">
          {translate(
            'auto.components.automations.workers.requiredChecksTitle',
            'Required Automated Checks'
          )}
        </span>
        <div className="space-y-1">
          {requiredChecks.map((chk, idx) => (
            <div
              key={chk.id ?? idx}
              className="flex items-center justify-between gap-2 rounded bg-muted/30 px-2 py-1 text-2xs"
            >
              <span className="font-mono truncate">{chk.description || chk.id}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="h-4 w-4 text-destructive"
                onClick={() => handleRemoveCheck(idx)}
                aria-label={translate(
                  'auto.components.automations.workers.removeCheck',
                  'Remove check: {{description}}',
                  { description: chk.description || chk.id }
                )}
              >
                <Trash2 className="size-2.5" />
              </Button>
            </div>
          ))}
          <div className="flex items-center gap-1.5 pt-1">
            <Input
              id="worker-new-check-input"
              value={newCheck}
              onChange={(e) => setNewCheck(e.target.value)}
              placeholder="e.g. pnpm test:contracts"
              aria-label={translate(
                'auto.components.automations.workers.newCheckLabel',
                'New automated check'
              )}
              className="font-mono text-xs h-7"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-2xs"
              onClick={handleAddCheck}
            >
              <Plus className="size-3 mr-1" />
              {translate('auto.components.automations.workers.add', 'Add')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
