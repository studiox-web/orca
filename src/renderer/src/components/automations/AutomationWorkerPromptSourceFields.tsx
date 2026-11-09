import React from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

type AutomationWorkerPromptSourceFieldsProps = {
  promptKind: 'inline' | 'source_reference'
  promptText: string
  promptPath: string
  promptDigest: string
  onPromptKindChange: (kind: 'inline' | 'source_reference') => void
  onPromptTextChange: (text: string) => void
  onPromptPathChange: (path: string) => void
  onPromptDigestChange: (digest: string) => void
}

export function AutomationWorkerPromptSourceFields({
  promptKind,
  promptText,
  promptPath,
  promptDigest,
  onPromptKindChange,
  onPromptTextChange,
  onPromptPathChange,
  onPromptDigestChange
}: AutomationWorkerPromptSourceFieldsProps): React.JSX.Element {
  return (
    <div className="space-y-2 rounded-md border border-border/50 p-3">
      <div className="flex items-center justify-between">
        <Label className="font-semibold text-xs">Prompt source</Label>
        <div
          role="radiogroup"
          aria-label="Prompt source type"
          className="flex rounded-md border border-border p-0.5 text-2xs"
        >
          <button
            type="button"
            role="radio"
            aria-checked={promptKind === 'inline'}
            className={`rounded px-2 py-0.5 ${
              promptKind === 'inline'
                ? 'bg-primary text-primary-foreground font-medium'
                : 'text-muted-foreground'
            }`}
            onClick={() => onPromptKindChange('inline')}
          >
            Inline
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={promptKind === 'source_reference'}
            className={`rounded px-2 py-0.5 ${
              promptKind === 'source_reference'
                ? 'bg-primary text-primary-foreground font-medium'
                : 'text-muted-foreground'
            }`}
            onClick={() => onPromptKindChange('source_reference')}
          >
            Source file
          </button>
        </div>
      </div>

      {promptKind === 'inline' ? (
        <div className="space-y-1">
          <Label htmlFor="prompt-inline-text" className="text-2xs text-muted-foreground">
            Inline instructions
          </Label>
          <Textarea
            id="prompt-inline-text"
            value={promptText}
            onChange={(e) => onPromptTextChange(e.target.value)}
            placeholder="Enter specialist instructions for this worker..."
            rows={4}
            className="font-mono text-xs"
          />
        </div>
      ) : (
        <div className="space-y-2">
          <div className="space-y-1">
            <Label htmlFor="prompt-path">File path</Label>
            <Input
              id="prompt-path"
              value={promptPath}
              onChange={(e) => onPromptPathChange(e.target.value)}
              placeholder="automations/goals/writer/GOAL.md"
              className="font-mono"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="prompt-digest">Pinned sha256 digest (optional)</Label>
            <Input
              id="prompt-digest"
              value={promptDigest}
              onChange={(e) => onPromptDigestChange(e.target.value)}
              placeholder="sha256:..."
              className="font-mono text-3xs"
            />
          </div>
        </div>
      )}
    </div>
  )
}
