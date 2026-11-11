// XOS fork: Personas & Media Studio (stage F, EM1-EM6). One goal's persona identity: SOUL.md voice
// traits editor and the sidecar generation launcher with a generic photoshoot prompt builder live
// here; the reference/photoshoot/journal/video galleries with the review workflow are in
// XosPersonaGalleries. Card identity/art come from the existing card.
import React, { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, ClipboardCopy, Play, Save, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { XosGoal, XosProject } from '../../../../shared/xos-goals-types'
import type { XosPersonaStudio } from '../../../../shared/xos-persona-types'
import { goalIdentity, useCardArt } from './XosGoalCard'
import type { CardThemeSelection } from './xos-goal-card-logic'
import type { XosGoalActions } from './XosGoalViewerParts'
import { PersonaGalleries } from './XosPersonaGalleries'

export function XosPersonaStudio({
  item,
  project,
  cardTheme,
  actions,
  onBack
}: {
  item: XosGoal
  project: XosProject
  cardTheme: CardThemeSelection
  actions: XosGoalActions
  onBack: () => void
}): React.JSX.Element {
  const api = window.api.xosGoals
  const identity = goalIdentity(item, cardTheme)
  const art = useCardArt(project.key, identity)
  const [studio, setStudio] = useState<XosPersonaStudio | null>(null)
  const [editingSoul, setEditingSoul] = useState(false)
  const [soulDraft, setSoulDraft] = useState('')
  const [sidecar, setSidecar] = useState('__none__')
  const [promptParts, setPromptParts] = useState({ pose: '', outfit: '', setting: '', notes: '' })

  const refresh = useCallback(async () => {
    if (!api) {
      return
    }
    const data = await api.getPersonaStudio({ projectKey: project.key, goal: item.goal })
    setStudio(data)
    if (data && !data.soulPath) {
      setEditingSoul(true)
    }
  }, [api, project.key, item.goal])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const mutate = useCallback(
    async (mutation: Parameters<NonNullable<typeof api>['mutatePersona']>[0]['mutation']) => {
      if (!api) {
        return false
      }
      const result = await api.mutatePersona({ projectKey: project.key, goal: item.goal, mutation })
      if (result.ok) {
        toast.success(result.message)
        await refresh()
      } else {
        toast.error(result.error)
      }
      return result.ok
    },
    [api, project.key, item.goal, refresh]
  )

  const builtPrompt = [
    `Photoshoot for ${identity.displayName} (${item.goal}, persona: ${identity.persona}).`,
    promptParts.pose && `Pose: ${promptParts.pose}.`,
    promptParts.outfit && `Outfit: ${promptParts.outfit}.`,
    promptParts.setting && `Setting: ${promptParts.setting}.`,
    promptParts.notes && `Notes: ${promptParts.notes}.`,
    'Stay on-model with the accepted reference images.'
  ]
    .filter(Boolean)
    .join(' ')

  const runSidecar = (): void => {
    if (sidecar === '__none__') {
      toast.error('Pick a sidecar contract first.')
      return
    }
    actions.runGoal(item, {
      mode: 'sidecar',
      sidecar,
      message:
        builtPrompt.includes('Pose:') || builtPrompt.includes('Notes:') ? builtPrompt : undefined
    })
  }

  const sidecars = studio?.sidecars ?? item.viewer.sidecars ?? []

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" />
          Goal viewer
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            {studio ? `${studio.reviewStats.pending} pending review` : 'Loading studio…'}
          </Badge>
          {item.viewer.soulPath && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => actions.openFile(item.viewer.soulPath!)}
            >
              <Save className="size-4" />
              SOUL.md
            </Button>
          )}
        </div>
      </div>

      <section className="overflow-hidden rounded-lg border">
        {art ? (
          <img src={art} alt="" className="aspect-[7/3] max-h-56 w-full object-cover" />
        ) : (
          <div className="aspect-[7/3] max-h-56 w-full bg-muted/40" />
        )}
        <div className="border-t p-4">
          <h1 className="text-lg font-semibold">{identity.displayName}</h1>
          <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-primary">
            {identity.persona} · {item.title}
          </p>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            {identity.description}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">Art prompt: {identity.artPrompt}</p>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border bg-muted/20 p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-primary">Persona voice (SOUL.md)</h2>
          {!editingSoul ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setSoulDraft(studio?.soul ?? `# ${item.title} Soul\n\n## Name\n\n## Core\n\n`)
                setEditingSoul(true)
              }}
            >
              <Sparkles className="size-4" />
              Edit voice
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={() => {
                void mutate({ kind: 'save-soul', soul: soulDraft })
                setEditingSoul(false)
              }}
            >
              <Save className="size-4" />
              Save voice
            </Button>
          )}
        </div>
        {editingSoul ? (
          <textarea
            value={soulDraft}
            onChange={(event) => setSoulDraft(event.target.value)}
            rows={10}
            className="w-full rounded-md border bg-background p-2 font-mono text-xs"
          />
        ) : studio?.soul ? (
          <dl className="grid gap-2 md:grid-cols-2">
            {studio.traits.map((trait) => (
              <div key={trait.key} className="rounded-md border bg-background/60 p-2 text-sm">
                <dt className="text-xs font-semibold text-muted-foreground">{trait.label}</dt>
                <dd className="mt-0.5 leading-6">{trait.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">
            No SOUL.md yet. The voice shapes how this persona writes, replies and poses.
          </p>
        )}
      </section>

      <section className="space-y-3 rounded-lg border bg-muted/20 p-3">
        <h2 className="text-sm font-semibold text-primary">Generation sidecar (EM6)</h2>
        <div className="grid gap-2 md:grid-cols-2">
          {(
            [
              ['pose', 'Pose'],
              ['outfit', 'Outfit'],
              ['setting', 'Setting'],
              ['notes', 'Notes']
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="block text-xs font-semibold text-muted-foreground">
              {label}
              <input
                value={promptParts[key]}
                onChange={(event) =>
                  setPromptParts((current) => ({ ...current, [key]: event.target.value }))
                }
                className="mt-1 w-full rounded-md border bg-background px-2 py-1 text-sm font-normal"
                placeholder={`${label.toLowerCase()}…`}
              />
            </label>
          ))}
        </div>
        <p className="break-words rounded-md border bg-background/60 p-2 text-xs leading-5 text-muted-foreground">
          {builtPrompt}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={sidecar}
            onChange={(event) => setSidecar(event.target.value)}
            className="rounded-md border bg-background px-2 py-1 text-sm"
          >
            <option value="__none__">Pick a sidecar…</option>
            {sidecars.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <Button type="button" size="sm" disabled={actions.busy !== null} onClick={runSidecar}>
            <Play className="size-4" />
            Run sidecar
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              void navigator.clipboard
                ?.writeText(builtPrompt)
                .then(() => toast.success('Prompt copied.'))
            }
          >
            <ClipboardCopy className="size-4" />
            Copy prompt
          </Button>
        </div>
        {sidecars.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No sidecars/&lt;name&gt;.md contracts yet. Add one to the goal folder to enable
            generation runs.
          </p>
        )}
      </section>

      {studio && (
        <PersonaGalleries
          projectKey={project.key}
          goal={item.goal}
          studio={studio}
          mutate={mutate}
          onOpenFile={actions.openFile}
        />
      )}
    </div>
  )
}
