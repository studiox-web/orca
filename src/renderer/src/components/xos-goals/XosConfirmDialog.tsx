// XOS fork: confirm dialog for board writes. Shows a preview of exactly what will change (§3d
// "bulk actions show a preview"), and can require typing a name for hard deletes.
import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

export type XosConfirmRequest = {
  title: string
  description: string
  /** What will change, one entry per line (crontab lines, goals…). */
  preview?: string[]
  confirmLabel: string
  destructive?: boolean
  /** When set, the user must type this exact text before confirming. */
  typedConfirm?: string
  onConfirm: () => Promise<boolean>
}

export function XosConfirmDialog({
  request,
  onClose
}: {
  request: XosConfirmRequest | null
  onClose: () => void
}): React.JSX.Element {
  const [typed, setTyped] = useState('')
  const [pending, setPending] = useState(false)
  const blocked = !!request?.typedConfirm && typed !== request.typedConfirm

  const close = (): void => {
    setTyped('')
    onClose()
  }

  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && !pending && close()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{request?.title}</DialogTitle>
          <DialogDescription>{request?.description}</DialogDescription>
        </DialogHeader>
        {request?.preview && request.preview.length > 0 && (
          <ul className="scrollbar-sleek max-h-56 space-y-1 overflow-y-auto rounded-md border bg-muted/35 p-2 font-mono text-xs">
            {request.preview.map((line) => (
              <li key={line} className="break-all">
                {line}
              </li>
            ))}
          </ul>
        )}
        {request?.typedConfirm && (
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">
              Type <code className="font-semibold text-foreground">{request.typedConfirm}</code> to
              confirm
            </span>
            <Input
              id="xos-typed-confirm"
              name="xos-typed-confirm"
              value={typed}
              autoFocus
              onChange={(event) => setTyped(event.target.value)}
            />
          </label>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={close}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={request?.destructive ? 'destructive' : 'default'}
            disabled={pending || blocked}
            onClick={() => {
              if (!request) {
                return
              }
              setPending(true)
              void request.onConfirm().then((ok) => {
                setPending(false)
                if (ok) {
                  close()
                }
              })
            }}
          >
            {request?.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
