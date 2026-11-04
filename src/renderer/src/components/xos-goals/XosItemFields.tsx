// XOS fork: Tasks → Goals item frontmatter field chips (§3h.2 drawer).
import React from 'react'

function fieldText(value: unknown): string {
  if (value === null || value === undefined) {
    return '—'
  }
  return typeof value === 'object' ? JSON.stringify(value, null, 1) : String(value)
}

export function XosItemFields({
  fields
}: {
  fields: [string, unknown][]
}): React.JSX.Element | null {
  if (fields.length === 0) {
    return null
  }
  return (
    <dl className="grid gap-2 sm:grid-cols-2">
      {fields.map(([key, value]) => (
        <div key={key} className="min-w-0 rounded-md border bg-background/60 p-2 text-sm">
          <dt className="text-xs font-semibold text-muted-foreground">{key}</dt>
          <dd className="whitespace-pre-wrap break-words">{fieldText(value)}</dd>
        </div>
      ))}
    </dl>
  )
}
