import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import {
  buildArticlePilotCreateRequest,
  loadArticlePilotInputs,
  type ArticlePilotSelection
} from './coordinated-article-pilot-package'
import { PILOT_INPUT_ROOT } from './coordinated-article-pilot-fixture'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function copyInputs() {
  const root = mkdtempSync(join(tmpdir(), 'coordinated-article-pilot-'))
  roots.push(root)
  const inputs = join(root, 'inputs')
  cpSync(PILOT_INPUT_ROOT, inputs, { recursive: true })
  return { root, inputs }
}

const selection: ArticlePilotSelection = {
  workspaceId: 'folder:isolated-fixture',
  promptAuthority: 'fixture:article-pilot',
  maxEstimatedCostUsd: 10,
  models: {
    'brief-review': { model: 'fixture-model-not-a-provider', reasoningEffort: 'medium' },
    'media-context': { model: 'fixture-model-not-a-provider', reasoningEffort: 'medium' },
    'write-draft': { model: 'fixture-model-not-a-provider', reasoningEffort: 'medium' },
    'editor-review': { model: 'fixture-model-not-a-provider', reasoningEffort: 'medium' }
  }
}

it('refuses prompt-byte drift before producing any native create payload', () => {
  const { inputs } = copyInputs()
  const writer = join(inputs, 'reference/automations/goals/content-writer/GOAL.md')
  writeFileSync(writer, `${readFileSync(writer, 'utf8')}\nchanged\n`)
  expect(() => loadArticlePilotInputs(inputs)).toThrow('pilot_input_digest_mismatch')
})

it('refuses a manifest reference outside its frozen root', () => {
  const { root, inputs } = copyInputs()
  writeFileSync(join(root, 'outside.md'), 'outside')
  const path = join(inputs, 'input-manifest.json')
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  manifest.entries[0].path = '../outside.md'
  writeFileSync(path, JSON.stringify(manifest))
  expect(() => loadArticlePilotInputs(inputs)).toThrow('pilot_input_path_invalid')
})

it('builds the native manual-only wire payload without a recurrence or client revision', () => {
  const inputs = loadArticlePilotInputs(PILOT_INPUT_ROOT)
  const request = buildArticlePilotCreateRequest(inputs, selection, 'fixture-create-once')
  expect(request.triggerPolicy).toBe('manual_only')
  expect(request.enabled).toBe(false)
  expect(request).not.toHaveProperty('rrule')
  expect(request).not.toHaveProperty('dtstart')
  expect(request).not.toHaveProperty('definitionRevision')
  expect(request.children.map((child) => child.launchConfig.model)).toEqual(
    Array(4).fill('fixture-model-not-a-provider')
  )
})

it('requires an explicit model for every Codex override and preserves identical comparison inputs', () => {
  const { inputs: secondRoot } = copyInputs()
  const first = loadArticlePilotInputs(PILOT_INPUT_ROOT)
  const second = loadArticlePilotInputs(secondRoot)
  expect(second.inputManifestDigest).toBe(first.inputManifestDigest)
  expect(() =>
    buildArticlePilotCreateRequest(
      first,
      {
        ...selection,
        models: { ...selection.models, 'write-draft': { model: '', reasoningEffort: 'high' } }
      },
      'fixture-create-once'
    )
  ).toThrow('pilot_explicit_model_required:write-draft')
  expect(buildArticlePilotCreateRequest(first, selection, 'fixture-create-once')).toEqual(
    buildArticlePilotCreateRequest(second, selection, 'fixture-create-once')
  )
})
