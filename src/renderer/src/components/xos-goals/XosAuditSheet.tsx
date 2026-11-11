// XOS fork: the audit log (§3d "every mutation goes into an audit log visible in the UI"):
// newest board writes from ~/.orca-xos/audit.jsonl, with the backup each one left behind.
import React, { useEffect, useState } from 'react'
import { History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import type { XosAuditEvent } from '../../../../shared/xos-goals-types'
import { formatTimestamp, relativeTime } from './xos-format'

const LIMIT = 150

function describe(event: XosAuditEvent): string {
  const subject =
    event.reason ??
    [event.goal, typeof event.area === 'string' ? `area ${event.area}` : null, event.project]
      .filter(Boolean)
      .join(' · ')
  return subject || ''
}

export function XosAuditButton({ generatedAt }: { generatedAt: string | null }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [events, setEvents] = useState<XosAuditEvent[] | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    let cancelled = false
    void window.api.xosGoals?.getAudit({ limit: LIMIT }).then((result) => {
      if (!cancelled) {
        setEvents(result)
      }
    })
    return () => {
      cancelled = true
    }
    // Reload when the board refreshes after a write while the sheet is open.
  }, [open, generatedAt])

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <History />
        History
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="sm:max-w-[640px]">
          <SheetHeader>
            <SheetTitle>Board history</SheetTitle>
            <SheetDescription>
              Every change made from the board: schedules, goals and areas. Crontab and org.json
              writes list the backup taken before the change.
            </SheetDescription>
          </SheetHeader>
          <div className="scrollbar-sleek min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-4">
            {events === null ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : events.length === 0 ? (
              <p className="text-sm text-muted-foreground">No changes recorded yet.</p>
            ) : (
              events.map((event, index) => (
                <div key={`${event.at}-${index}`} className="rounded-lg border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <code className="text-xs font-semibold text-primary">{event.action}</code>
                    <span className="text-xs text-muted-foreground" title={event.at}>
                      {formatTimestamp(event.at)} ({relativeTime(event.at)})
                    </span>
                  </div>
                  {describe(event) && <p className="mt-1">{describe(event)}</p>}
                  {event.lines?.map((line) => (
                    <p
                      key={line}
                      className="mt-1 break-all font-mono text-xs text-muted-foreground"
                    >
                      {line}
                    </p>
                  ))}
                  {event.backup && (
                    <p className="mt-1 break-all text-xs text-muted-foreground">
                      Backup: {event.backup}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
