import { sha256 } from './sha256'

export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text)
  const digest = sha256(bytes)
  let hex = ''
  for (let i = 0; i < digest.length; i++) {
    hex += digest[i].toString(16).padStart(2, '0')
  }
  return hex
}

export function deepFreeze<T>(obj: T): Readonly<T> {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      deepFreeze(obj[i])
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Object.freeze recursively freezes array contents
    return Object.freeze(obj) as unknown as Readonly<T>
  }
  for (const [, val] of Object.entries(obj)) {
    if (val !== null && typeof val === 'object') {
      deepFreeze(val)
    }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Object.freeze freezes all properties
  return Object.freeze(obj) as Readonly<T>
}

export function toCanonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(toCanonicalJson).join(',')}]`
  }
  const entries = Object.entries(value)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${JSON.stringify(k)}:${toCanonicalJson(v)}`)
  return `{${entries.join(',')}}`
}
