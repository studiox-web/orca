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
  XosAutomationRunConfig,
  XosModelChoice,
  XosRunAttempt
} from '../../shared/xos-runtime-types'
import { xosHome } from './xos-crontab'

const MAX_FALLBACKS = 5
const LEDGER_TAIL_BYTES = 1024 * 1024

type ConfigFile = { version: 1; automations: Record<string, XosAutomationRunConfig> }

export const EMPTY_RUN_CONFIG: XosAutomationRunConfig = {
  fallbacks: [],
  fallbackOnManualRuns: false
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
    return { version: 1, automations: parsed.automations ?? {} }
  } catch {
    return { version: 1, automations: {} }
  }
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
  const stored = readConfigFile().automations[automationId]
  if (!stored) {
    return EMPTY_RUN_CONFIG
  }
  return {
    fallbacks: (stored.fallbacks ?? [])
      .map(cleanChoice)
      .filter((choice): choice is XosModelChoice => choice !== null)
      .slice(0, MAX_FALLBACKS),
    fallbackOnManualRuns: stored.fallbackOnManualRuns === true
  }
}

export function writeRunConfig(automationId: string, config: XosAutomationRunConfig): void {
  const file = readConfigFile()
  const fallbacks = config.fallbacks
    .map(cleanChoice)
    .filter((choice): choice is XosModelChoice => choice !== null)
    .slice(0, MAX_FALLBACKS)
  if (fallbacks.length === 0 && !config.fallbackOnManualRuns) {
    delete file.automations[automationId]
  } else {
    file.automations[automationId] = {
      fallbacks,
      fallbackOnManualRuns: config.fallbackOnManualRuns
    }
  }
  mkdirSync(xosHome(), { recursive: true })
  const tmp = `${configPath()}.tmp`
  writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`)
  renameSync(tmp, configPath())
}

type LedgerEvent =
  | ({ type: 'attempt' } & Omit<XosRunAttempt, 'outcome'>)
  | ({ type: 'outcome'; runId: string } & NonNullable<XosRunAttempt['outcome']>)

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
  for (const event of readLedgerTail()) {
    if (event.type === 'attempt' && event.automationId === automationId) {
      const { type: _type, ...attempt } = event
      attempts.set(event.runId, { ...attempt, outcome: null })
    } else if (event.type === 'outcome') {
      const { type: _type, runId, ...outcome } = event
      outcomes.set(runId, outcome)
    }
  }
  return [...attempts.values()]
    .map((attempt) => ({ ...attempt, outcome: outcomes.get(attempt.runId) ?? null }))
    .toReversed()
    .slice(0, Math.max(1, Math.min(limit, 200)))
}
