import React, { useMemo, useState } from 'react'
import { Plus, List, Network, History } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type {
  ChildLaunchConfigField,
  CoordinatedAutomationChildDefinition,
  CoordinatedAutomationInheritedDefaults,
  ResolvedAutomationRunSnapshot,
  AutomationOutcomeContract,
  CoordinatedAutomationCeilings,
  CoordinatedAutomationPublicationPolicy,
  CoordinatedAutomationRetentionPolicy
} from '../../../../shared/coordinated-automation-types'
import { validateCoordinatedAutomationDefinition } from '../../../../shared/coordinated-automation-validation'
import {
  addChildWorker,
  removeChildWorker,
  reorderChildWorkers,
  resetChildLaunchConfigFieldToInherited,
  updateChildWorker
} from './automation-workers-state'
import { AutomationWorkerCard } from './AutomationWorkerCard'
import { AutomationWorkersGraph } from './AutomationWorkersGraph'
import { AutomationWorkersValidationSummary } from './AutomationWorkersValidationSummary'
import { AutomationRevisionImpactPreview } from './AutomationRevisionImpactPreview'
import { AutomationHistoricalSnapshotViewer } from './AutomationHistoricalSnapshotViewer'
import { AutomationWorkerEditorDialog } from './AutomationWorkerEditorDialog'
import { translate } from '@/i18n/i18n'

type ViewMode = 'list' | 'graph' | 'historical'

type AutomationWorkersSectionProps = {
  workers: readonly CoordinatedAutomationChildDefinition[]
  definitionRevision?: number
  outcomeContract?: AutomationOutcomeContract
  inheritedDefaults?: CoordinatedAutomationInheritedDefaults
  globalCeilings?: CoordinatedAutomationCeilings
  publicationPolicy?: CoordinatedAutomationPublicationPolicy
  retentionPolicy?: CoordinatedAutomationRetentionPolicy
  isEditing?: boolean
  hasModifications?: boolean
  activeRunId?: string | null
  activeRunRevision?: number | null
  historicalSnapshot?: ResolvedAutomationRunSnapshot | null
  onWorkersChange?: (workers: CoordinatedAutomationChildDefinition[]) => void
  onResetField?: (childId: string, field: ChildLaunchConfigField) => void
  className?: string
}

export function AutomationWorkersSection({
  workers,
  definitionRevision = 1,
  outcomeContract,
  inheritedDefaults,
  globalCeilings,
  publicationPolicy,
  retentionPolicy,
  isEditing = false,
  hasModifications = false,
  activeRunId = null,
  activeRunRevision = null,
  historicalSnapshot = null,
  onWorkersChange,
  onResetField,
  className = ''
}: AutomationWorkersSectionProps): React.JSX.Element {
  const [viewMode, setViewMode] = useState<ViewMode>(historicalSnapshot ? 'historical' : 'list')
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null)
  const [editingChild, setEditingChild] = useState<CoordinatedAutomationChildDefinition | null>(
    null
  )
  const [editorDialogOpen, setEditorDialogOpen] = useState(false)

  // Validate definition against shared Phase 1 validators
  const validationResult = useMemo(() => {
    if (!outcomeContract && workers.length === 0) {
      return { valid: true, errors: [] }
    }
    const def = {
      kind: 'coordinated' as const,
      definitionRevision,
      outcomeContract: outcomeContract ?? {
        humanStatement: 'Default workflow contract',
        acceptanceCriteria: [],
        requiredApprovals: [],
        allowedFinalStates: ['completed']
      },
      children: [...workers],
      inheritedDefaults,
      globalCeilings,
      publicationPolicy,
      retentionPolicy
    }
    return validateCoordinatedAutomationDefinition(def, undefined, globalCeilings)
  }, [
    workers,
    definitionRevision,
    outcomeContract,
    inheritedDefaults,
    globalCeilings,
    publicationPolicy,
    retentionPolicy
  ])

  const handleAddWorker = (): void => {
    const next = addChildWorker(workers, undefined, inheritedDefaults)
    onWorkersChange?.(next)
    const newlyAdded = next.at(-1)
    if (newlyAdded) {
      setEditingChild(newlyAdded)
      setEditorDialogOpen(true)
    }
  }

  const handleUpdateWorker = (
    childId: string,
    patch: Partial<CoordinatedAutomationChildDefinition>
  ): void => {
    const next = updateChildWorker(workers, childId, patch)
    onWorkersChange?.(next)
  }

  const handleRemoveWorker = (childId: string): void => {
    const next = removeChildWorker(workers, childId)
    onWorkersChange?.(next)
  }

  const handleMoveUp = (index: number): void => {
    const next = reorderChildWorkers(workers, index, index - 1)
    onWorkersChange?.(next)
  }

  const handleMoveDown = (index: number): void => {
    const next = reorderChildWorkers(workers, index, index + 1)
    onWorkersChange?.(next)
  }

  const handleResetField = (childId: string, field: ChildLaunchConfigField): void => {
    if (onResetField) {
      onResetField(childId, field)
      return
    }
    const target = workers.find((c) => c.id === childId)
    if (!target) {
      return
    }
    const updated = resetChildLaunchConfigFieldToInherited(target, field)
    const next = updateChildWorker(workers, childId, updated)
    onWorkersChange?.(next)
  }

  const handleOpenEditor = (child: CoordinatedAutomationChildDefinition): void => {
    setEditingChild(child)
    setEditorDialogOpen(true)
  }

  const handleSaveEditor = (saved: CoordinatedAutomationChildDefinition): void => {
    const next = updateChildWorker(workers, saved.id, saved)
    onWorkersChange?.(next)
  }

  return (
    <section
      aria-label={translate(
        'auto.components.automations.workers.sectionTitle',
        'Specialist workers'
      )}
      className={`space-y-4 ${className}`}
      data-testid="automation-workers-section"
    >
      {/* Header with Title, Count, View Modes, and Add button */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-base text-foreground">
            {translate('auto.components.automations.workers.title', 'Workers')}
          </h3>
          <Badge variant="secondary" className="font-mono text-xs">
            {workers.length}
          </Badge>
          {!validationResult.valid ? (
            <Badge variant="destructive" className="text-3xs uppercase tracking-wider">
              {validationResult.errors.length}{' '}
              {validationResult.errors.length === 1 ? 'issue' : 'issues'}
            </Badge>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {/* Segmented view mode buttons */}
          <div className="flex items-center rounded-md border border-border/60 bg-muted/40 p-0.5 text-xs">
            <Button
              type="button"
              variant={viewMode === 'list' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 gap-1 px-2.5 text-2xs"
              onClick={() => setViewMode('list')}
              aria-label={translate('auto.components.automations.workers.listView', 'List view')}
            >
              <List className="size-3.5" aria-hidden="true" />
              <span>List</span>
            </Button>
            <Button
              type="button"
              variant={viewMode === 'graph' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 gap-1 px-2.5 text-2xs"
              onClick={() => setViewMode('graph')}
              aria-label={translate('auto.components.automations.workers.graphView', 'Graph view')}
            >
              <Network className="size-3.5" aria-hidden="true" />
              <span>Graph</span>
            </Button>
            {historicalSnapshot ? (
              <Button
                type="button"
                variant={viewMode === 'historical' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 gap-1 px-2.5 text-2xs"
                onClick={() => setViewMode('historical')}
                aria-label={translate(
                  'auto.components.automations.workers.historicalView',
                  'Historical snapshot'
                )}
              >
                <History className="size-3.5" aria-hidden="true" />
                <span>Snapshot</span>
              </Button>
            ) : null}
          </div>

          {/* Add worker button in edit mode */}
          {isEditing ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-2xs"
              onClick={handleAddWorker}
              aria-label={translate('auto.components.automations.workers.addWorker', 'Add worker')}
            >
              <Plus className="size-3.5" />
              <span>Add worker</span>
            </Button>
          ) : null}
        </div>
      </div>

      {/* Validation Summary */}
      <AutomationWorkersValidationSummary
        errors={validationResult.errors}
        onSelectChild={(childId) => {
          setSelectedChildId(childId)
          setViewMode('list')
        }}
      />

      {/* Future Revision Impact Preview */}
      <AutomationRevisionImpactPreview
        currentRevision={definitionRevision}
        hasModifications={hasModifications}
        activeRunId={activeRunId}
        activeRunRevision={activeRunRevision}
      />

      {/* Main presentation: Historical vs Graph vs List */}
      {viewMode === 'historical' && historicalSnapshot ? (
        <AutomationHistoricalSnapshotViewer snapshot={historicalSnapshot} />
      ) : viewMode === 'graph' ? (
        <AutomationWorkersGraph
          workers={workers}
          selectedChildId={selectedChildId}
          onSelectChild={(id) => {
            setSelectedChildId(id)
            setViewMode('list')
          }}
        />
      ) : workers.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/70 p-8 text-center text-xs text-muted-foreground"
          data-testid="automation-workers-empty"
        >
          <p>
            {translate(
              'auto.components.automations.workers.emptyState',
              'No specialist workers defined yet.'
            )}
          </p>
          {isEditing ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-3 gap-1"
              onClick={handleAddWorker}
            >
              <Plus className="size-3.5" />
              <span>Add first worker</span>
            </Button>
          ) : null}
        </div>
      ) : (
        <div
          role="list"
          aria-label={translate(
            'auto.components.automations.workers.listAria',
            'Specialist workers list'
          )}
          className="space-y-3"
          data-testid="automation-workers-list"
        >
          {workers.map((child, index) => (
            <AutomationWorkerCard
              key={child.id}
              child={child}
              index={index}
              totalCount={workers.length}
              parentDefaults={inheritedDefaults}
              isEditing={isEditing}
              allChildren={workers}
              errors={validationResult.errors}
              onUpdate={handleUpdateWorker}
              onRemove={handleRemoveWorker}
              onMoveUp={handleMoveUp}
              onMoveDown={handleMoveDown}
              onResetField={handleResetField}
              onEditWorker={handleOpenEditor}
            />
          ))}
        </div>
      )}

      {/* Worker editor dialog */}
      <AutomationWorkerEditorDialog
        open={editorDialogOpen}
        worker={editingChild}
        allWorkers={workers}
        parentDefaults={inheritedDefaults}
        onOpenChange={setEditorDialogOpen}
        onSave={handleSaveEditor}
      />
    </section>
  )
}
