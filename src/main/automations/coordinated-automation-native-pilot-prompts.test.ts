import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { resolveAutomationSnapshot } from '../../shared/coordinated-automation-snapshot'
import { createCoordinatedAutomation } from '../persistence/scheduling-automations/coordinated-automation-definition-operations'
import {
  child,
  coordinatedCreateInput,
  coordinatedTestState,
  durableHarness
} from '../persistence/scheduling-automations/coordinated-automation-persistence.test-support'
import { createNativePilotPromptResolver } from './coordinated-automation-native-pilot-prompts'

let root = ''
afterEach(() => {
  if (root) {
    rmSync(root, { recursive: true, force: true })
  }
})

it('freezes verified source text and authority while refusing traversal, foreign authority and modified bytes', () => {
  root = mkdtempSync(join(tmpdir(), 'native-pilot-prompts-'))
  const inputRoot = join(root, 'inputs')
  mkdirSync(inputRoot)
  const text = 'Write exactly one draft from the frozen input.'
  const path = join(inputRoot, 'writer.md')
  writeFileSync(path, text)
  writeFileSync(join(root, 'outside.md'), 'Must never enter the snapshot')
  symlinkSync(join(root, 'outside.md'), join(inputRoot, 'escape.md'))
  const promptResolver = createNativePilotPromptResolver({
    inputRoot,
    workspacePath: root,
    promptAuthority: 'pilot:local'
  })
  const source = {
    kind: 'source_reference' as const,
    path: 'inputs/writer.md',
    authority: 'pilot:local',
    digest: `sha256:${createHash('sha256').update(text).digest('hex')}`
  }
  const harness = durableHarness(coordinatedTestState())
  const automation = createCoordinatedAutomation(
    harness.definitions(),
    coordinatedCreateInput({ children: [child('writer', { promptSource: source })] })
  )
  const snapshot = resolveAutomationSnapshot({ automation, promptResolver })
  expect(snapshot.resolvedChildren[0].prompt).toEqual({ ...source, text })
  for (const patch of [
    { authority: 'foreign' },
    { path: '../outside.md' },
    { path: 'inputs/escape.md' },
    { path }
  ]) {
    expect(() => promptResolver({ ...source, ...patch })).toThrow()
  }
  writeFileSync(path, 'Changed after selection')
  expect(() => resolveAutomationSnapshot({ automation, promptResolver })).toThrow(/digest mismatch/)
  expect(snapshot.resolvedChildren[0].prompt.text).toBe(text)
})
