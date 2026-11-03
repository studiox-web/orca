// XOS fork: the operations "spell card", ported from DJVibe's AutomationCard / RunBattleMeter /
// OpsCastingCostPips. Inertia links became buttons; art loads from the project or the shared deck.
import React, { useEffect, useState } from 'react'
import { Crown, Mail, Pause, RefreshCw, Shield, Users } from 'lucide-react'
import type { XosGoal } from '../../../../shared/xos-goals-types'
import { automationCardIdentity, type AutomationCardIdentity } from './xos-card-identities'
import {
  automationBattleStats,
  automationCastingCost,
  automationPerformanceProfile,
  automationRunBattleMeter,
  cardToneClasses,
  subagentBadgeLabel,
  type CardThemeSelection,
  type RunMeter
} from './xos-goal-card-logic'
import { fitCardText, formatTimestamp } from './xos-format'
import anthropicIcon from './assets/anthropic.png'
import codexIcon from './assets/codex.png'
import antigravityIcon from './assets/antigravity.jpg'

const artCache = new Map<string, Promise<string | null>>()

function loadArt(projectKey: string, relativePath: string): Promise<string | null> {
  const key = `${projectKey}\0${relativePath}`
  let pending = artCache.get(key)
  if (!pending) {
    pending = window.api.xosGoals?.cardArt({ projectKey, relativePath }) ?? Promise.resolve(null)
    artCache.set(key, pending)
  }
  return pending
}

/** First available image among the identity's art paths (themed, then the plain fallback). */
export function useCardArt(projectKey: string, identity: AutomationCardIdentity): string | null {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    const candidates = [identity.imageSrc, identity.fallbackImageSrc].filter(
      (path): path is string => !!path
    )
    void (async () => {
      for (const path of candidates) {
        const data = await loadArt(projectKey, path)
        if (data) {
          if (!cancelled) {
            setSrc(data)
          }
          return
        }
      }
      if (!cancelled) {
        setSrc(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectKey, identity.imageSrc, identity.fallbackImageSrc])
  return src
}

export function goalIdentity(item: XosGoal, cardTheme: CardThemeSelection): AutomationCardIdentity {
  const castingCost = automationCastingCost(item)
  const battleStats = automationBattleStats(item)
  return automationCardIdentity({
    goal: item.goal,
    role: item.title,
    areaTitle: item.area.title,
    isManager: item.goal === item.area.manager,
    isCSuite: item.area.id === 'c-suite',
    costPips: castingCost.count,
    power: battleStats.power,
    toughness: battleStats.toughness,
    runs7d: item.viewer.usage7d.runs,
    runs30d: item.viewer.usage30d.runs,
    tokens30d: item.viewer.usage30d.tokens,
    ...automationPerformanceProfile(item),
    theme: cardTheme.theme,
    imageMode: cardTheme.imageMode
  })
}

export function RunBattleMeter({ meter }: { meter: RunMeter }): React.JSX.Element {
  return (
    <div className="ops-run-meter" title={meter.label} role="img" aria-label={meter.label}>
      {meter.bars.map((bar) => (
        <span
          key={bar.key}
          className={[
            'ops-run-meter-bar',
            `ops-run-meter-bar-${bar.tone}`,
            bar.isLatest ? 'is-latest' : '',
            bar.isEmpty ? 'is-empty' : '',
            meter.streakTone ? `is-streak-${meter.streakTone}` : ''
          ]
            .filter(Boolean)
            .join(' ')}
          title={bar.label}
          aria-hidden="true"
        />
      ))}
    </div>
  )
}

const PROVIDER_ICONS: Record<string, { src: string; alt: string }> = {
  anthropic: { src: anthropicIcon, alt: 'Claude' },
  codex: { src: codexIcon, alt: 'Codex' },
  antigravity: { src: antigravityIcon, alt: 'Antigravity' }
}

export function OpsCastingCostPips({
  pips
}: {
  pips: { count?: number | string; tone: string }[]
}): React.JSX.Element {
  return (
    <>
      {pips.map((pip, index) => {
        const icon = PROVIDER_ICONS[pip.tone]
        if (icon) {
          return (
            <span
              key={`${pip.tone}-${index}`}
              className="inline-flex items-center justify-center overflow-hidden rounded-full shadow-sm"
              aria-hidden="true"
            >
              <img
                src={icon.src}
                alt={icon.alt}
                className="size-5 rounded-full object-cover shadow-sm"
              />
            </span>
          )
        }
        return (
          <span
            key={`${pip.tone}-${index}`}
            className={`ops-spell-pip ${pip.tone}`}
            aria-hidden="true"
          >
            {pip.count}
          </span>
        )
      })}
    </>
  )
}

export function XosGoalCard({
  item,
  projectKey,
  cardTheme,
  onOpen
}: {
  item: XosGoal
  projectKey: string
  cardTheme: CardThemeSelection
  onOpen: (item: XosGoal) => void
}): React.JSX.Element {
  const isManager = item.goal === item.area.manager
  const isCSuite = item.area.id === 'c-suite'
  const castingCost = automationCastingCost(item)
  const battleStats = automationBattleStats(item)
  const runMeter = automationRunBattleMeter(item)
  const identity = goalIdentity(item, cardTheme)
  const art = useCardArt(projectKey, identity)
  const nextRunText = item.paused
    ? 'Paused: the schedule is off until you resume it.'
    : item.viewer.cron.configured
      ? `Next trigger: ${formatTimestamp(item.nextRun) ?? 'schedule pending'}`
      : 'No schedule yet.'

  return (
    <div className="relative w-full max-w-72 rounded-lg">
      <button
        type="button"
        onClick={() => onOpen(item)}
        className="xos-card-link block w-full rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label={`View ${identity.role} goal: ${identity.displayName}`}
      >
        <div
          className={[
            'ops-spell-card flex flex-col border bg-card text-card-foreground shadow-sm h-[25.25rem] w-full gap-0 overflow-hidden rounded-lg py-0 transition-colors hover:border-primary/50',
            isCSuite ? 'c-suite-foil-card c-suite-foil' : '',
            isManager && !isCSuite ? 'ops-spell-card-manager border-primary/40 bg-primary/5' : '',
            item.paused ? 'opacity-70 grayscale-[0.6]' : '',
            ...cardToneClasses(runMeter),
            cardTheme.theme === 'festival' ? 'ops-spell-card-festival' : ''
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <div className="flex flex-col gap-2 p-3 pb-0">
            <div className="ops-spell-card-nameplate flex items-center justify-between gap-2 rounded-md border px-3 py-2">
              <h3 className="min-w-0 truncate text-sm tracking-normal font-semibold">
                {identity.displayName}
              </h3>
              <div className="flex shrink-0 items-center gap-1.5">
                {item.paused && (
                  <span
                    className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border px-1.5 xos-tone-warning"
                    title="Schedule paused"
                    aria-label="Schedule paused"
                  >
                    <Pause className="size-3" />
                  </span>
                )}
                {item.messages.inboxOpen > 0 && (
                  <span
                    className="inline-flex h-6 min-w-6 items-center justify-center gap-1 rounded-full border px-1.5 text-[10px] font-bold xos-tone-warning"
                    title={`${item.messages.inboxOpen} open inbox message${item.messages.inboxOpen === 1 ? '' : 's'}`}
                  >
                    <Mail className="size-3" />
                    {item.messages.inboxOpen}
                  </span>
                )}
                {item.viewer.subagents.configured && (
                  <span
                    className={[
                      'inline-flex h-6 min-w-6 items-center justify-center gap-1 rounded-full border px-1.5 text-[10px] font-bold',
                      item.viewer.subagents.heavy
                        ? 'xos-tone-warning'
                        : 'border-primary/30 bg-primary/10 text-primary'
                    ].join(' ')}
                    title={subagentBadgeLabel(item)}
                  >
                    <Users className="size-3" />
                    {item.viewer.subagents.expectedCount}
                  </span>
                )}
                <div className="flex items-center gap-1" title={castingCost.label}>
                  <OpsCastingCostPips pips={castingCost.pips} />
                </div>
              </div>
            </div>

            <div className="ops-spell-art-frame relative flex h-28 items-center justify-center overflow-hidden rounded-md border">
              {art && <img src={art} alt="" className="h-full w-full object-cover" />}
            </div>

            <div className="ops-spell-type-line flex items-center justify-between gap-2 rounded-sm border px-3 py-1.5">
              <p className="flex min-w-0 items-center gap-1.5 truncate text-[11px] font-semibold text-foreground">
                {isCSuite && <Crown className="ops-spell-regent-type-icon" aria-hidden="true" />}
                {isManager && !isCSuite && (
                  <Shield className="ops-spell-marshal-type-icon" aria-hidden="true" />
                )}
                {identity.typeLine}
              </p>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 p-3 pt-2">
            <section className="ops-spell-rules-box flex min-h-0 flex-1 flex-col rounded-md border bg-card/85 p-3">
              {cardTheme.theme === 'noir' && (
                <p className="truncate text-[11px] font-semibold text-primary">
                  {identity.persona}
                </p>
              )}
              <p
                className={[
                  'ops-spell-card-copy text-sm leading-5 text-foreground',
                  cardTheme.theme === 'noir' ? 'mt-2' : ''
                ].join(' ')}
              >
                {fitCardText(identity.description, 86)}
              </p>
              <p className="ops-spell-card-flavor mt-auto border-t pt-2 text-[11px] italic leading-4 text-muted-foreground">
                {nextRunText}
              </p>
            </section>
            <div className="flex items-center justify-between gap-2">
              <RunBattleMeter meter={runMeter} />
              <span className="ops-spell-stat-box" title={battleStats.label}>
                {battleStats.power}/{battleStats.toughness}
              </span>
            </div>
          </div>
        </div>
      </button>
      {item.running && (
        <span
          className="pointer-events-none absolute bottom-3 right-[4.25rem] z-10 inline-flex size-8 items-center justify-center rounded-sm border border-primary/30 bg-background/95 text-primary shadow-sm"
          title={`Running (pid ${item.running.pid})`}
        >
          <RefreshCw className="size-4 animate-spin motion-reduce:animate-none" />
        </span>
      )}
    </div>
  )
}
