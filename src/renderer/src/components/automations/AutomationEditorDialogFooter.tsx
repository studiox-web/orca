import React from 'react'
import { Sparkles, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'

type AutomationEditorDialogFooterProps = {
  isEditing: boolean
  isSaving: boolean
  canSave: boolean
  hasProjects: boolean
  isCoordinated?: boolean
  onOpenChange: (open: boolean) => void
  onSave: () => void
}

export function AutomationEditorDialogFooter({
  isEditing,
  isSaving,
  canSave,
  hasProjects,
  isCoordinated = false,
  onOpenChange,
  onSave
}: AutomationEditorDialogFooterProps): React.JSX.Element {
  const saveLabel = isEditing
    ? translate('auto.components.automations.AutomationEditorDialog.777548c2d6', 'Save Changes')
    : isSaving
      ? translate('auto.components.automations.AutomationEditorDialog.a9d9dccf77', 'Save')
      : translate('auto.components.automations.AutomationEditorDialog.e46c1aa9ad', 'Create')

  const isSaveDisabled = isCoordinated || isSaving || (!isEditing && !hasProjects) || !canSave

  return (
    <div className="flex items-center justify-between gap-3 border-t border-border/50 px-5 py-3">
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        {isCoordinated ? (
          <>
            <Info className="size-3.5 shrink-0 text-status-warning" aria-hidden="true" />
            <span
              className="truncate text-status-warning-text"
              data-testid="coordinated-persistence-unavailable-message"
            >
              {translate(
                'auto.components.automations.editor.persistenceUnavailable',
                'Coordinated automation persistence is not available yet in this preview. Workers can be designed and tested here, but cannot be saved.'
              )}
            </span>
          </>
        ) : (
          <>
            <Sparkles className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {translate(
                'auto.components.automations.AutomationEditorDialog.e8c2a14f70',
                'Once saved, runs automatically until paused.'
              )}
            </span>
          </>
        )}
      </div>
      <div className="flex shrink-0 justify-end gap-2">
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          {translate('auto.components.automations.AutomationEditorDialog.fb1896a5e7', 'Cancel')}
        </Button>
        <Button
          onClick={isCoordinated ? undefined : onSave}
          disabled={isSaveDisabled}
          title={
            isCoordinated
              ? translate(
                  'auto.components.automations.editor.persistenceDisabledTooltip',
                  'Coordinated automations cannot be saved in this preview (persistence not integrated)'
                )
              : undefined
          }
        >
          {saveLabel}
        </Button>
      </div>
    </div>
  )
}
