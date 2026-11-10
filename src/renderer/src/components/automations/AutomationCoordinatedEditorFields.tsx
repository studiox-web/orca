import React from 'react'
import { translate } from '@/i18n/i18n'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { AutomationDraft } from './AutomationEditorDialog'
import { AutomationWorkersSection } from './AutomationWorkersSection'

const FIELD_LABEL_CLASS = 'font-semibold text-2xs uppercase tracking-wider text-muted-foreground'

type AutomationCoordinatedEditorFieldsProps = {
  draft: AutomationDraft
  isEditing: boolean
  isCoordinatedFeatureEnabled: boolean
  onDraftChange: (updater: (current: AutomationDraft) => AutomationDraft) => void
}

/** Coordinated parent fields. Name and coordinator brief are shown here because
 * the host requires both; hiding them would make every save fail validation. */
export function AutomationCoordinatedEditorFields({
  draft,
  isEditing,
  isCoordinatedFeatureEnabled,
  onDraftChange
}: AutomationCoordinatedEditorFieldsProps): React.JSX.Element {
  const readOnly = !isCoordinatedFeatureEnabled
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5 scrollbar-sleek">
      {readOnly ? (
        <div className="rounded-md border border-status-warning-border bg-status-warning-background p-3 text-2xs text-status-warning-text">
          {translate(
            'auto.components.automations.editor.flagOffNotice',
            'Coordinated automations require the experimental feature flag to be enabled in Settings. Viewing in safe read-only mode.'
          )}
        </div>
      ) : null}

      {draft.scheduleWarning ? (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {draft.scheduleWarning}
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="automation-coordinated-name" className={FIELD_LABEL_CLASS}>
          {translate(
            'auto.components.automations.AutomationEditorDialogHeader.58f56b73d9',
            'Automation name'
          )}
        </Label>
        <Input
          id="automation-coordinated-name"
          name="automation-coordinated-name"
          value={draft.name}
          disabled={readOnly}
          onChange={(event) => {
            const name = event.target.value
            onDraftChange((curr) => ({ ...curr, name }))
          }}
          placeholder="Publish weekly article"
          className="text-xs"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="automation-outcome-statement" className={FIELD_LABEL_CLASS}>
          Outcome statement
        </Label>
        <Textarea
          id="automation-outcome-statement"
          name="automation-outcome-statement"
          value={draft.outcomeContract?.humanStatement ?? ''}
          disabled={readOnly}
          onChange={(e) => {
            const text = e.target.value
            onDraftChange((curr) => ({
              ...curr,
              outcomeContract: {
                ...curr.outcomeContract,
                humanStatement: text,
                acceptanceCriteria: curr.outcomeContract?.acceptanceCriteria ?? [],
                requiredApprovals: curr.outcomeContract?.requiredApprovals ?? [],
                allowedFinalStates: curr.outcomeContract?.allowedFinalStates ?? ['completed']
              }
            }))
          }}
          placeholder="Describe the desired end-to-end outcome that specialist workers must achieve..."
          rows={2}
          className="text-xs"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="automation-coordinated-brief" className={FIELD_LABEL_CLASS}>
          Coordinator brief
        </Label>
        <Textarea
          id="automation-coordinated-brief"
          name="automation-coordinated-brief"
          value={draft.prompt}
          disabled={readOnly}
          onChange={(event) => {
            const prompt = event.target.value
            onDraftChange((curr) => ({ ...curr, prompt }))
          }}
          placeholder="Shared context every worker receives, such as the publication, audience, and house rules."
          rows={3}
          className="text-xs"
        />
      </div>

      <AutomationWorkersSection
        workers={draft.children ?? []}
        definitionRevision={isEditing ? (draft.definitionRevision ?? 1) : null}
        outcomeContract={draft.outcomeContract}
        inheritedDefaults={{
          agentId: draft.agentId,
          surface: draft.surface,
          extraAgentArgs: draft.extraAgentArgs,
          workspaceMode: draft.workspaceMode,
          workspaceId: draft.workspaceId,
          baseBranch: draft.baseBranch,
          setupDecision: draft.setupDecision,
          reuseSession: draft.reuseSession
        }}
        isEditing={isCoordinatedFeatureEnabled}
        hasModifications={false}
        onWorkersChange={(children) => {
          onDraftChange((curr) => ({ ...curr, children }))
        }}
      />
    </div>
  )
}
