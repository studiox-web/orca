import React from 'react'
import { FileCode2, TerminalSquare } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { FileTypeIcon } from '@/components/FileTypeIcon'
import type { UnifiedScriptEvidence } from '../../../../shared/unified-automation-types'

export function unifiedScriptCommandEvidence(command: string | null): {
  kind: 'python-file' | 'shell' | 'command'
  filePath: string | null
  interpreter: string | null
} {
  if (!command) {
    return { kind: 'command', filePath: null, interpreter: null }
  }
  const firstToken = command.trim().match(/^(?:"([^"]+)"|'([^']+)'|(\S+))/)
  const interpreter = firstToken?.[1] ?? firstToken?.[2] ?? firstToken?.[3] ?? null
  const basename = interpreter?.replaceAll('\\', '/').split('/').pop()?.toLowerCase() ?? ''
  const pythonFile = command.match(/(?:^|\s)([^\s"']+\.py)(?:\s|$)/i)?.[1] ?? null
  if (pythonFile || /^python(?:3(?:\.\d+)?)?(?:\.exe)?$/.test(basename) || basename === 'py') {
    return { kind: 'python-file', filePath: pythonFile, interpreter }
  }
  const shells = [
    'sh',
    'bash',
    'zsh',
    'fish',
    'pwsh',
    'pwsh.exe',
    'powershell',
    'powershell.exe',
    'cmd.exe'
  ]
  return shells.includes(basename)
    ? { kind: 'shell', filePath: null, interpreter }
    : { kind: 'command', filePath: null, interpreter: null }
}

export function UnifiedAutomationDetailScriptEvidence({
  evidence,
  host
}: {
  evidence: UnifiedScriptEvidence | null | undefined
  host: string
}): React.JSX.Element {
  const command = evidence?.command ?? null
  const presentation = unifiedScriptCommandEvidence(command)
  const icon =
    presentation.kind === 'python-file' ? (
      <FileTypeIcon filePath={presentation.filePath ?? 'script.py'} className="size-5" />
    ) : presentation.kind === 'shell' ? (
      <TerminalSquare className="size-5" aria-hidden />
    ) : (
      <FileCode2 className="size-5" aria-hidden />
    )
  return (
    <section className="rounded-xl border bg-card p-4 text-card-foreground shadow-xs">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-semibold">Reviewed Script evidence</h2>
        {evidence?.provenance === 'legacy-cron' ? <Badge variant="outline">Legacy</Badge> : null}
      </div>
      <dl className="mt-3 grid gap-3 text-sm [grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr))]">
        <div>
          <dt className="text-xs font-medium text-muted-foreground">Command</dt>
          <dd className="mt-1 break-all font-mono text-xs">
            {command || 'Missing from the current source data'}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">Interpreter evidence</dt>
          <dd className="mt-1 break-all font-mono text-xs">
            {presentation.interpreter || 'Not explicitly recorded'}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">Arguments</dt>
          <dd className="mt-1 text-xs text-muted-foreground">
            Not separately structured in the current source data
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">Working directory</dt>
          <dd className="mt-1 break-all font-mono text-xs">{evidence?.cwd || 'Not recorded'}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">Host</dt>
          <dd className="mt-1 text-xs">{host}</dd>
        </div>
        {evidence?.replacesCronCommand ? (
          <div>
            <dt className="text-xs font-medium text-muted-foreground">
              Replaced cron command evidence
            </dt>
            <dd className="mt-1 break-all font-mono text-xs">{evidence.replacesCronCommand}</dd>
          </div>
        ) : null}
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">
        View-only. Validation, cancellation, timeout, artifact retention, and execution controls are
        unavailable.
      </p>
    </section>
  )
}
