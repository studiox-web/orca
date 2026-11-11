// XOS fork: number/date/text formatting for the goal board (from DJVibe's dashboard helpers).

export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1
  }).format(value)
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value < 1 ? 3 : 2
  }).format(value)
}

export function formatDuration(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null
  }
  const seconds = Math.max(0, Math.round(value))
  if (seconds < 60) {
    return `${seconds}s`
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return `${minutes}m ${seconds % 60}s`
  }
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** Absolute date-time for ISO stamps; non-dates (e.g. "2026-11-02 14:27 PDT" prose) pass through. */
export function formatTimestamp(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) {
    return value
  }
  return new Date(parsed).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

export function relativeTime(value: string | null | undefined, now = Date.now()): string | null {
  const parsed = value ? Date.parse(value) : Number.NaN
  if (Number.isNaN(parsed)) {
    return null
  }
  const diff = Math.round((parsed - now) / 60_000)
  const abs = Math.abs(diff)
  const text =
    abs < 60 ? `${abs}m` : abs < 48 * 60 ? `${Math.round(abs / 60)}h` : `${Math.round(abs / 1440)}d`
  return diff >= 0 ? `in ${text}` : `${text} ago`
}

export function preferredTelemetryValue(...values: (string | null | undefined)[]): string | null {
  const value = values.find((candidate) => {
    const normalized = candidate?.trim().toLowerCase()
    return normalized !== undefined && normalized !== '' && normalized !== 'unknown'
  })
  return value?.trim() ?? null
}

export function fitCardText(value: string, maxLength: number): string {
  const trimmed = value.trim()
  if (trimmed.length <= maxLength) {
    return trimmed
  }
  const clipped = trimmed.slice(0, maxLength - 1).trimEnd()
  const lastSpace = clipped.lastIndexOf(' ')
  return `${clipped.slice(0, lastSpace > 48 ? lastSpace : clipped.length)}…`
}
