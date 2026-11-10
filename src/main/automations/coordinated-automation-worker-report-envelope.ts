import { createHash } from 'node:crypto'
import { toCanonicalJson } from '../../shared/coordinated-automation-canonical-digest'

/** Marker between the readable report and its structured envelope in a Task result. */
export const COORDINATED_WORKER_REPORT_MARKER = '<!-- orca:coordinated-worker-report -->'
export const COORDINATED_WORKER_REPORT_ENVELOPE_VERSION = 1

export type DecodedWorkerReport =
  | {
      kind: 'structured'
      /** 0 marks a pre-envelope (Phase 4) result admitted for compatibility. */
      envelopeVersion: 0 | 1
      source: 'coordinated' | 'worker_done' | 'legacy_json'
      report: unknown
      readable: string
    }
  | { kind: 'readable_only'; readable: string }
  | { kind: 'unsupported'; readable: string; reason: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function structuredReportDigest(report: unknown): string {
  return `sha256:${createHash('sha256').update(toCanonicalJson(report)).digest('hex')}`
}

function readableText(report: unknown): string {
  if (!isRecord(report)) {
    return ''
  }
  const parts = [report.summary, report.reportMarkdown].filter(
    (part): part is string => typeof part === 'string' && part.length > 0
  )
  return parts.join('\n\n')
}

/** Readable report first so humans and old readers keep working; the envelope follows. */
export function encodeCoordinatedWorkerReport(report: unknown, admissionError?: string): string {
  const readable = [admissionError, readableText(report)].filter(Boolean).join('\n\n')
  const envelope = {
    provenance: 'coordinated_worker_report',
    envelopeVersion: COORDINATED_WORKER_REPORT_ENVELOPE_VERSION,
    reportDigest: structuredReportDigest(report),
    ...(admissionError ? { admissionError } : {}),
    structuredResult: report
  }
  return `${readable}\n\n${COORDINATED_WORKER_REPORT_MARKER}\n${JSON.stringify(envelope)}`
}

function decodeEnvelope(readable: string, json: string): DecodedWorkerReport {
  let envelope: unknown
  try {
    envelope = JSON.parse(json)
  } catch {
    return { kind: 'unsupported', readable, reason: 'Structured envelope is not valid JSON.' }
  }
  if (!isRecord(envelope) || envelope.provenance !== 'coordinated_worker_report') {
    return { kind: 'unsupported', readable, reason: 'Structured envelope has no provenance.' }
  }
  if (envelope.envelopeVersion !== COORDINATED_WORKER_REPORT_ENVELOPE_VERSION) {
    return {
      kind: 'unsupported',
      readable,
      reason: `Structured envelope version ${String(envelope.envelopeVersion)} is not supported.`
    }
  }
  return {
    kind: 'structured',
    envelopeVersion: 1,
    source: 'coordinated',
    report: envelope.structuredResult,
    readable
  }
}

/** Reads every result shape a coordinated Task can hold; only structured ones are admissible. */
export function decodeWorkerReportResult(result: string | null | undefined): DecodedWorkerReport {
  if (!result) {
    return { kind: 'readable_only', readable: '' }
  }
  const markerIndex = result.lastIndexOf(COORDINATED_WORKER_REPORT_MARKER)
  if (markerIndex !== -1) {
    return decodeEnvelope(
      result.slice(0, markerIndex).trimEnd(),
      result.slice(markerIndex + COORDINATED_WORKER_REPORT_MARKER.length)
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(result)
  } catch {
    return { kind: 'readable_only', readable: result }
  }
  if (isRecord(parsed) && parsed.provenance === 'worker_report') {
    const readable = typeof parsed.body === 'string' ? parsed.body : ''
    return isRecord(parsed.structuredResult)
      ? {
          kind: 'structured',
          envelopeVersion: 1,
          source: 'worker_done',
          report: parsed.structuredResult,
          readable
        }
      : { kind: 'readable_only', readable }
  }
  if (isRecord(parsed) && 'schemaVersion' in parsed && 'dispatchId' in parsed) {
    return {
      kind: 'structured',
      envelopeVersion: 0,
      source: 'legacy_json',
      report: parsed,
      readable: readableText(parsed)
    }
  }
  return { kind: 'readable_only', readable: result }
}
