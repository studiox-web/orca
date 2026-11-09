import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { AutomationKind } from '../../../../shared/automations-types'
import type { AutomationTemplate } from './automation-templates'
import { translate } from '@/i18n/i18n'

type AutomationEditorDialogHeaderProps = {
  isEditing: boolean
  isCreateMode: boolean
  templateOpen: boolean
  templates: AutomationTemplate[]
  isCoordinatedFeatureEnabled?: boolean
  kind?: AutomationKind
  onKindChange?: (kind: AutomationKind) => void
  onTemplateOpenChange: (open: boolean) => void
  onApplyTemplate: (template: AutomationTemplate) => void
}

function AutomationTemplateCard({
  template,
  onSelect
}: {
  template: AutomationTemplate
  onSelect: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="rounded-md border border-border/70 bg-background px-3 py-2 text-left shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <div className="text-[11px] font-medium uppercase text-muted-foreground">
        {template.category}
      </div>
      <div className="mt-1 text-sm font-medium">{template.label}</div>
      <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{template.description}</div>
    </button>
  )
}

function getEditorTitle(args: { isEditing: boolean }): string {
  if (args.isEditing) {
    return translate(
      'auto.components.automations.AutomationEditorDialogHeader.17086b48ee',
      'Edit automation'
    )
  }
  return translate(
    'auto.components.automations.AutomationEditorDialogHeader.4133d33862',
    'Create automation'
  )
}

export function AutomationEditorDialogHeader({
  isEditing,
  isCreateMode,
  templateOpen,
  templates,
  isCoordinatedFeatureEnabled = false,
  kind = 'single',
  onKindChange,
  onTemplateOpenChange,
  onApplyTemplate
}: AutomationEditorDialogHeaderProps): React.JSX.Element {
  const title = getEditorTitle({ isEditing })

  return (
    <DialogHeader className="flex-row items-center justify-between gap-3 border-b border-border/50 px-5 py-2.5 pr-12 text-left">
      <div className="flex items-center gap-3">
        <DialogTitle className="min-w-0 truncate text-sm font-medium">{title}</DialogTitle>
        {isCoordinatedFeatureEnabled ? (
          <div
            role="radiogroup"
            aria-label={translate(
              'auto.components.automations.editor.modeGroupAria',
              'Automation execution mode'
            )}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault()
                onKindChange?.('coordinated')
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault()
                onKindChange?.('single')
              }
            }}
            className="flex items-center rounded-md border border-border/60 bg-muted/40 p-0.5 text-xs"
          >
            <button
              type="button"
              role="radio"
              aria-checked={kind !== 'coordinated'}
              tabIndex={kind !== 'coordinated' ? 0 : -1}
              className={`rounded px-2.5 py-1 text-2xs font-medium transition-colors ${
                kind !== 'coordinated'
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => onKindChange?.('single')}
              aria-label={translate(
                'auto.components.automations.editor.singleModeAria',
                'Single prompt mode'
              )}
            >
              {translate('auto.components.automations.editor.singleMode', 'Single prompt')}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={kind === 'coordinated'}
              tabIndex={kind === 'coordinated' ? 0 : -1}
              className={`rounded px-2.5 py-1 text-2xs font-medium transition-colors ${
                kind === 'coordinated'
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => onKindChange?.('coordinated')}
              aria-label={translate(
                'auto.components.automations.editor.coordinatedModeAria',
                'Coordinated workers mode'
              )}
            >
              {translate(
                'auto.components.automations.editor.coordinatedMode',
                'Coordinated workers'
              )}
            </button>
          </div>
        ) : null}
      </div>
      {isCreateMode ? (
        <div className="flex shrink-0 items-center gap-2">
          <Popover open={templateOpen} onOpenChange={onTemplateOpenChange}>
            <PopoverTrigger asChild>
              <Button type="button" variant="ghost" size="sm">
                <Sparkles className="size-4" />
                {translate(
                  'auto.components.automations.AutomationEditorDialogHeader.31f9253920',
                  'Use template'
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-96 p-3">
              <div className="grid gap-2">
                {templates.map((template) => (
                  <AutomationTemplateCard
                    key={template.id}
                    template={template}
                    onSelect={() => onApplyTemplate(template)}
                  />
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      ) : null}
    </DialogHeader>
  )
}
