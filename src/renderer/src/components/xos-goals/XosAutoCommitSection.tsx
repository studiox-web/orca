// XOS fork: RT8 auto-commit settings: the paths this automation owns, the commit message, and push.
// Paths can be copied from the project's legacy commit-automation-changes.sh policy for a goal.
import React, { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useAppStore } from '@/store'
import { getAutomationRunRepoId } from '../../../../shared/automation-run-identity'
import type { Automation } from '../../../../shared/automations-types'
import type {
  XosAutomationRunConfig,
  XosLegacyCommitPolicy
} from '../../../../shared/xos-runtime-types'

const splitPaths = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

export function XosAutoCommitSection({
  automation,
  config,
  onSave
}: {
  automation: Automation
  config: XosAutomationRunConfig
  onSave: (next: XosAutomationRunConfig) => void
}): React.JSX.Element {
  const api = window.api?.xosGoals
  const repoPath = useAppStore(
    (state) => state.repos.find((repo) => repo.id === getAutomationRunRepoId(automation))?.path
  )
  const [policies, setPolicies] = useState<XosLegacyCommitPolicy[]>([])
  const [open, setOpen] = useState(config.autoCommit !== null)
  const commit = config.autoCommit

  useEffect(() => {
    if (!api || !repoPath) {
      return
    }
    let live = true
    void api.getLegacyCommitPolicies({ repoPath }).then((next) => {
      if (live) {
        setPolicies(next)
      }
    })
    return () => {
      live = false
    }
  }, [api, repoPath])

  const savePaths = (paths: string[]): void =>
    onSave({
      ...config,
      autoCommit: paths.length > 0 ? { message: null, push: false, ...commit, paths } : null
    })

  return (
    <div className="space-y-2 border-t pt-3">
      <label className="flex items-center justify-between gap-2 text-xs font-medium">
        Commit changes after each run
        <Switch
          checked={open}
          onCheckedChange={(checked) => {
            setOpen(checked)
            if (!checked) {
              onSave({ ...config, autoCommit: null })
            }
          }}
        />
      </label>
      {open && (
        <>
          {policies.length > 0 && (
            <Select
              value=""
              onValueChange={(goal) => {
                const policy = policies.find((entry) => entry.goal === goal)
                if (policy) {
                  savePaths(policy.paths)
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full"
                aria-label="Copy paths from a legacy goal"
              >
                <SelectValue placeholder="Copy owned paths from a crontab goal…" />
              </SelectTrigger>
              <SelectContent>
                {policies.map((policy) => (
                  <SelectItem key={policy.goal} value={policy.goal}>
                    {policy.goal} ({policy.paths.length})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <label
            htmlFor="xos-commit-paths"
            className="block space-y-1 text-xs text-muted-foreground"
          >
            <span>Owned paths (one per line, relative to the repo)</span>
            <Textarea
              key={commit?.paths.join('\n') ?? ''}
              id="xos-commit-paths"
              name="xos-commit-paths"
              variant="code"
              rows={4}
              placeholder={'automations/goals/content-writer\ncontent/drafts'}
              defaultValue={commit?.paths.join('\n') ?? ''}
              onBlur={(event) => savePaths(splitPaths(event.target.value))}
            />
          </label>
          {commit && (
            <div className="flex items-end gap-3">
              <label
                htmlFor="xos-commit-message"
                className="flex-1 space-y-1 text-xs text-muted-foreground"
              >
                <span>Commit message</span>
                <Input
                  key={commit.message ?? ''}
                  id="xos-commit-message"
                  name="xos-commit-message"
                  placeholder={`chore(automation): ${automation.name}`}
                  defaultValue={commit.message ?? ''}
                  onBlur={(event) =>
                    onSave({
                      ...config,
                      autoCommit: { ...commit, message: event.target.value.trim() || null }
                    })
                  }
                />
              </label>
              <label className="flex h-9 items-center gap-2 text-xs text-muted-foreground">
                Push
                <Switch
                  checked={commit.push}
                  onCheckedChange={(push) => onSave({ ...config, autoCommit: { ...commit, push } })}
                />
              </label>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            After a finished run, only changes under these paths are committed, one commit at a time
            per project (shared with crontab goals). Other changes are left alone.
            {automation.workspaceMode !== 'existing' &&
              ' This automation makes a new worktree per run, so nothing is committed for it.'}
          </p>
        </>
      )}
    </div>
  )
}
