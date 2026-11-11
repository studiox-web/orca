// XOS fork: stage A runtime state outside upstream's store, so its schema never migrates.
// - automation-runtime.json: per-automation run config (fallback chain), keyed by automation id.
// - automation-runs.jsonl: append-only attempt/outcome events (RT6 fallback telemetry, GD2 model per
//   run). The desktop app and orcad never run at once (shared profile lock), so plain files suffice.
import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import type {
  XosAutoCommitConfig,
  XosAutoModeConfig,
  XosAutomationRunConfig,
  XosGoalBinding,
  XosModelChoice,
  XosModelTier,
  XosRunAttempt,
  XosRunCommit,
  XosScriptBinding
} from '../../shared/xos-runtime-types'
import { xosHome } from './xos-crontab'

const MAX_FALLBACKS = 5
const LEDGER_TAIL_BYTES = 1024 * 1024

type ConfigFile = {
  version: 1
  automations: Record<string, XosAutomationRunConfig>
  /** Auto mode tier map edits, keyed "agent:model"; null = explicitly unassigned. */
  tiers?: Record<string, XosModelTier | null>
}

const TIERS: readonly XosModelTier[] = ['high', 'standard', 'light']
const MAX_COMMIT_PATHS = 60

export const EMPTY_RUN_CONFIG: XosAutomationRunConfig = {
  fallbacks: [],
  fallbackOnManualRuns: false,
  lockLane: null,
  lockWaitMinutes: 0,
  timeoutMinutes: null,
  autoCommit: null,
  auto: null,
  goal: null,
  script: null
}

const LANE = /^[a-z0-9][a-z0-9-]{0,40}$/

/** Normalizes untrusted input (IPC or a hand-edited file) into a valid config. */
export function cleanRunConfig(
  value: Partial<XosAutomationRunConfig> | undefined
): XosAutomationRunConfig {
  const minutes = (raw: unknown, max: number): number =>
    Math.min(max, Math.max(0, Math.round(Number(raw) || 0)))
  const lane = typeof value?.lockLane === 'string' ? value.lockLane.trim().toLowerCase() : ''
  const timeout = minutes(value?.timeoutMinutes, 24 * 60)
  return {
    fallbacks: (value?.fallbacks ?? [])
      .map(cleanChoice)
      .filter((choice): choice is XosModelChoice => choice !== null)
      .slice(0, MAX_FALLBACKS),
    fallbackOnManualRuns: value?.fallbackOnManualRuns === true,
    lockLane: LANE.test(lane) ? lane : null,
    lockWaitMinutes: minutes(value?.lockWaitMinutes, 240),
    timeoutMinutes: timeout > 0 ? timeout : null,
    autoCommit: cleanAutoCommit(value?.autoCommit),
    auto: cleanAuto(value?.auto),
    goal: cleanGoalBinding(value?.goal),
    script: cleanScriptBinding(value?.script)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function cleanGoalBinding(value: unknown): XosGoalBinding | null {
  if (!isRecord(value) || typeof value.repoRoot !== 'string' || typeof value.goal !== 'string') {
    return null
  }
  return value.goal ? { repoRoot: value.repoRoot, goal: value.goal } : null
}

function cleanScriptBinding(value: unknown): XosScriptBinding | null {
  if (!isRecord(value) || typeof value.command !== 'string' || typeof value.cwd !== 'string') {
    return null
  }
  const replaces = value.replacesCronCommand
  return value.command.trim()
    ? {
        command: value.command,
        cwd: value.cwd,
        replacesCronCommand: typeof replaces === 'string' && replaces ? replaces : null
      }
    : null
}

/** Repo-relative, inside the repo: no absolute paths and no `..` segments. */
export function cleanCommitPath(raw: string): string | null {
  const path = raw.trim().replace(/^\.\//, '').replace(/\/+$/, '')
  if (!path || path.length > 300 || path.startsWith('/') || path.startsWith(':')) {
    return null
  }
  return path.split('/').some((part) => part === '..') ? null : path
}

function cleanAutoCommit(value: unknown): XosAutoCommitConfig | null {
  const row = value as Partial<XosAutoCommitConfig> | null | undefined
  if (!row || !Array.isArray(row.paths)) {
    return null
  }
  const paths = Array.from(
    new Set(
      row.paths
        .map((path) => (typeof path === 'string' ? cleanCommitPath(path) : null))
        .filter((path): path is string => path !== null)
    )
  ).slice(0, MAX_COMMIT_PATHS)
  if (paths.length === 0) {
    return null
  }
  const message =
    typeof row.message === 'string' && row.message.trim() ? row.message.trim().slice(0, 200) : null
  return { paths, message, push: row.push === true }
}

function cleanAuto(value: unknown): XosAutoModeConfig | null {
  const row = value as Partial<XosAutoModeConfig> | null | undefined
  if (!row || !TIERS.includes(row.tier as XosModelTier)) {
    return null
  }
  const providers = Array.isArray(row.providers)
    ? Array.from(new Set(row.providers.filter((agent) => typeof agent === 'string' && agent)))
    : []
  return {
    tier: row.tier as XosModelTier,
    providers: providers.length > 0 ? providers.slice(0, 8) : ['claude', 'codex'],
    reservePercent: Math.min(50, Math.max(0, Math.round(Number(row.reservePercent) || 0))),
    effort: typeof row.effort === 'string' && row.effort.trim() ? row.effort.trim() : null
  }
}

function isEmpty(config: XosAutomationRunConfig): boolean {
  return (
    config.fallbacks.length === 0 &&
    !config.fallbackOnManualRuns &&
    config.lockLane === null &&
    config.timeoutMinutes === null &&
    config.autoCommit === null &&
    config.auto === null &&
    config.goal === null &&
    config.script === null
  )
}

/** Every automation bound to a goal or a script: the cutover view of what replaced what. */
export function listRunConfigs(): Record<string, XosAutomationRunConfig> {
  return readConfigFile().automations
}

function configPath(): string {
  return join(xosHome(), 'automation-runtime.json')
}

function ledgerPath(): string {
  return join(xosHome(), 'automation-runs.jsonl')
}

function readConfigFile(): ConfigFile {
  try {
    const parsed = JSON.parse(readFileSync(configPath(), 'utf8')) as Partial<ConfigFile>
    return { version: 1, automations: parsed.automations ?? {}, tiers: parsed.tiers ?? {} }
  } catch {
    return { version: 1, automations: {}, tiers: {} }
  }
}

function writeConfigFile(file: ConfigFile): void {
  mkdirSync(xosHome(), { recursive: true })
  const tmp = `${configPath()}.tmp`
  writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`)
  renameSync(tmp, configPath())
}

/** Tier map edits (plan §3.3). Missing key = use the default inferred from the model name. */
export function readTierEdits(): Record<string, XosModelTier | null> {
  return readConfigFile().tiers ?? {}
}

export function writeTierEdit(key: string, tier: XosModelTier | null | undefined): void {
  const file = readConfigFile()
  const tiers = { ...file.tiers }
  if (tier === undefined) {
    delete tiers[key]
  } else {
    tiers[key] = tier !== null && TIERS.includes(tier) ? tier : null
  }
  writeConfigFile({ ...file, tiers })
}

function cleanChoice(value: unknown): XosModelChoice | null {
  const row = value as Partial<XosModelChoice> | null
  if (!row || typeof row.agent !== 'string' || !row.agent) {
    return null
  }
  const text = (field: unknown): string | null =>
    typeof field === 'string' && field.trim() ? field.trim() : null
  return { agent: row.agent, model: text(row.model), effort: text(row.effort) }
}

export function readRunConfig(automationId: string): XosAutomationRunConfig {
  return cleanRunConfig(readConfigFile().automations[automationId])
}

export function writeRunConfig(
  automationId: string,
  config: Partial<XosAutomationRunConfig>
): void {
  const file = readConfigFile()
  const clean = cleanRunConfig(config)
  if (isEmpty(clean)) {
    delete file.automations[automationId]
  } else {
    file.automations[automationId] = clean
  }
  writeConfigFile(file)
}

type LedgerEvent =
  | ({ type: 'attempt' } & Omit<XosRunAttempt, 'outcome' | 'commit'>)
  | ({ type: 'outcome'; runId: string } & NonNullable<XosRunAttempt['outcome']>)
  | ({ type: 'commit'; runId: string } & XosRunCommit)

export function appendLedger(event: LedgerEvent): void {
  try {
    mkdirSync(xosHome(), { recursive: true })
    appendFileSync(ledgerPath(), `${JSON.stringify(event)}\n`)
  } catch (error) {
    console.warn('[xos] could not record a run attempt', error)
  }
}

function readLedgerTail(): LedgerEvent[] {
  let fd: number | null = null
  try {
    const size = statSync(ledgerPath()).size
    const start = Math.max(0, size - LEDGER_TAIL_BYTES)
    fd = openSync(ledgerPath(), 'r')
    const buffer = Buffer.alloc(size - start)
    readSync(fd, buffer, 0, buffer.length, start)
    const lines = buffer.toString('utf8').split('\n').filter(Boolean)
    const events: LedgerEvent[] = []
    for (const line of start > 0 ? lines.slice(1) : lines) {
      try {
        events.push(JSON.parse(line) as LedgerEvent)
      } catch {
        // Skip a torn line.
      }
    }
    return events
  } catch {
    return []
  } finally {
    if (fd !== null) {
      closeSync(fd)
    }
  }
}

/** Attempts of one automation, newest first, each with its outcome when recorded. */
export function readRunAttempts(automationId: string, limit: number): XosRunAttempt[] {
  const attempts = new Map<string, XosRunAttempt>()
  const outcomes = new Map<string, XosRunAttempt['outcome']>()
  const commits = new Map<string, XosRunCommit>()
  for (const event of readLedgerTail()) {
    if (event.type === 'attempt' && event.automationId === automationId) {
      const { type: _type, ...attempt } = event
      attempts.set(event.runId, { ...attempt, outcome: null, commit: null })
    } else if (event.type === 'outcome') {
      const { type: _type, runId, ...outcome } = event
      outcomes.set(runId, outcome)
    } else if (event.type === 'commit') {
      const { type: _type, runId, ...commit } = event
      commits.set(runId, commit)
    }
  }
  return Array.from(attempts.values())
    .map((attempt) => ({
      ...attempt,
      outcome: outcomes.get(attempt.runId) ?? null,
      commit: commits.get(attempt.runId) ?? null
    }))
    .toReversed()
    .slice(0, Math.max(1, Math.min(limit, 200)))
}
