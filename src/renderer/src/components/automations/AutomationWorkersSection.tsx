import React, { useEffect, useMemo, useState } from 'react'
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
  createDefaultChildDefinition,
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
import { AutomationWorkerDeleteConfirmDialog } from './AutomationWorkerDeleteConfirmDialog'
import { translate } from '@/i18n/i18n'

type ViewMode = 'list' | 'graph' | 'historical'

type AutomationWorkersSectionProps = {
  workers: readonly CoordinatedAutomationChildDefinition[]
  definitionRevision?: number | null
  outcomeContract?: AutomationOutcomeContract
  inheritedDefaults?: CoordinatedAutomationInheritedDefaults
  globalCeilings?: CoordinatedAutomationCeilings
  publicationPolicy?: CoordinatedAutomationPublicationPolicy
  retentionPolicy?: CoordinatedAutomationRetentionPolicy
  isEditing?: boolean
  hasModifications?: boolean
  activeRunId?: string | null
  activeRunRevision?: number | null
  activeRunStatus?: string | null
  snapshotRunId?: string | null
  historicalSnapshot?: ResolvedAutomationRunSnapshot | null
  onWorkersChange?: (workers: CoordinatedAutomationChildDefinition[]) => void
  onResetField?: (childId: string, field: ChildLaunchConfigField) => void
  className?: string
}

export function AutomationWorkersSection({
  workers,
  definitionRevision = null,
  outcomeContract,
  inheritedDefaults,
  globalCeilings,
  publicationPolicy,
  retentionPolicy,
  isEditing = false,
  hasModifications = false,
  activeRunId = null,
  activeRunRevision = null,
  activeRunStatus = null,
  snapshotRunId = null,
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
  const [isAddingNewWorker, setIsAddingNewWorker] = useState(false)
  const [editorDialogOpen, setEditorDialogOpen] = useState(false)
  const [workerToDelete, setWorkerToDelete] = useState<CoordinatedAutomationChildDefinition | null>(
    null
  )

  useEffect(() => {
    if (selectedChildId && viewMode === 'list') {
      const el = document.getElementById(`worker-card-${selectedChildId}`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        el.focus()
      }
    }
  }, [selectedChildId, viewMode])

  const validationResult = useMemo(() => {
    if (!outcomeContract && workers.length === 0) {
      return { valid: true, errors: [] }
    }
    const def = {
      kind: 'coordinated' as const,
      definitionRevision: definitionRevision ?? 1,
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
    const fresh = createDefaultChildDefinition(workers.length)
    setEditingChild(fresh)
    setIsAddingNewWorker(true)
    setEditorDialogOpen(true)
  }

  const handleUpdateWorker = (
    childId: string,
    patch: Partial<CoordinatedAutomationChildDefinition>
  ): void => {
    const next = updateChildWorker(workers, childId, patch)
    onWorkersChange?.(next)
  }

  const handleRequestRemoveWorker = (childId: string): void => {
    const target = workers.find((c) => c.id === childId)
    if (!target) {
      return
    }
    const hasDependents = workers.some((w) => w.dependencies.some((d) => d.childId === childId))
    if (hasDependents || target.name || target.promptSource.kind === 'source_reference') {
      setWorkerToDelete(target)
    } else {
      const next = removeChildWorker(workers, childId)
      onWorkersChange?.(next)
    }
  }

  const handleConfirmRemoveWorker = (): void => {
    if (!workerToDelete) {
      return
    }
    const next = removeChildWorker(workers, workerToDelete.id)
    onWorkersChange?.(next)
    setWorkerToDelete(null)
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
    setIsAddingNewWorker(false)
    setEditorDialogOpen(true)
  }

  const handleSaveEditor = (saved: CoordinatedAutomationChildDefinition): void => {
    if (isAddingNewWorker) {
      onWorkersChange?.([...workers, saved])
    } else {
      const next = updateChildWorker(workers, saved.id, saved)
      onWorkersChange?.(next)
    }
    setIsAddingNewWorker(false)
  }

  const dependentWorkers = workerToDelete
    ? workers.filter((w) => w.dependencies.some((d) => d.childId === workerToDelete.id))
    : []

  return (
    <section
      aria-label={translate(
        'auto.components.automations.workers.sectionTitle',
        'Specialist workers'
      )}
      className={`@container space-y-4 ${className}`}
      data-testid="automation-workers-section"
    >
      {/* Header */}
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
          <div className="flex items-center rounded-md border border-border/60 bg-muted/40 p-0.5 text-xs">
            <Button
              type="button"
              variant={viewMode === 'list' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 gap-1 px-2.5 text-2xs"
              onClick={() => setViewMode('list')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setViewMode('list')
                }
              }}
              aria-label={translate('auto.components.automations.workers.listView', 'List view')}
            >
              <List className="size-3.5" aria-hidden="true" />
              <span>{translate('auto.components.automations.workers.list', 'List')}</span>
            </Button>
            <Button
              type="button"
              variant={viewMode === 'graph' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 gap-1 px-2.5 text-2xs"
              onClick={() => setViewMode('graph')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setViewMode('graph')
                }
              }}
              aria-label={translate('auto.components.automations.workers.graphView', 'Graph view')}
            >
              <Network className="size-3.5" aria-hidden="true" />
              <span>{translate('auto.components.automations.workers.graph', 'Graph')}</span>
            </Button>
            {historicalSnapshot ? (
              <Button
                type="button"
                variant={viewMode === 'historical' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 gap-1 px-2.5 text-2xs"
                onClick={() => setViewMode('historical')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setViewMode('historical')
                  }
                }}
                aria-label={translate(
                  'auto.components.automations.workers.historicalView',
                  'Historical snapshot'
                )}
              >
                <History className="size-3.5" aria-hidden="true" />
                <span>{translate('auto.components.automations.workers.snapshot', 'Snapshot')}</span>
              </Button>
            ) : null}
          </div>

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
              <span>
                {translate('auto.components.automations.workers.addWorker', 'Add worker')}
              </span>
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
        activeRunStatus={activeRunStatus}
      />

      {/* View modes */}
      {viewMode === 'historical' && historicalSnapshot ? (
        <AutomationHistoricalSnapshotViewer snapshot={historicalSnapshot} runId={snapshotRunId} />
      ) : viewMode === 'graph' ? (
        <AutomationWorkersGraph
          workers={workers}
          parentDefaults={inheritedDefaults}
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
              isSelected={selectedChildId === child.id}
              allChildren={workers}
              errors={validationResult.errors}
              onUpdate={handleUpdateWorker}
              onRemove={handleRequestRemoveWorker}
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
        onOpenChange={(open) => {
          setEditorDialogOpen(open)
          if (!open) {
            setIsAddingNewWorker(false)
          }
        }}
        onSave={handleSaveEditor}
      />

      {/* Delete confirmation dialog */}
      <AutomationWorkerDeleteConfirmDialog
        worker={workerToDelete}
        dependentWorkers={dependentWorkers}
        onCancel={() => setWorkerToDelete(null)}
        onConfirm={handleConfirmRemoveWorker}
      />
    </section>
  )
}
