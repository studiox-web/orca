import { join } from 'node:path'
import { expect, it } from 'vitest'
import { planChangedChecks, splitUnitTestInputs } from './check-changed-selection.mjs'

const scriptsDir = join(import.meta.dirname)
const plan = (files) => planChangedChecks(files, { scriptsDir })
const checkNames = (files) => plan(files).checks.map((check) => check.name)

it('skips typecheck, tests, and verifiers for a docs-only change but keeps the format gate', () => {
  expect(plan(['docs/STYLEGUIDE.md'])).toEqual({
    staticAnalysis: true,
    typecheckProjects: [],
    unitTests: { related: [], colocated: [] },
    checks: []
  })
})

it('routes generated-artifact inputs to their verifiers', () => {
  expect(checkNames(['src/renderer/src/i18n/locales/fr.json'])).toEqual(
    expect.arrayContaining(['localization catalogs', 'localization coverage'])
  )
  expect(checkNames(['src/main/runtime/rpc/methods/worktree.ts'])).toContain('rpc params catalog')
  expect(checkNames(['skills/orca-cli/SKILL.md'])).toEqual([
    'bundled skill guides',
    'skill bundle manifest'
  ])
})

it('limits typecheck to the projects a tree reaches', () => {
  expect(plan(['src/renderer/src/App.tsx']).typecheckProjects).toEqual([
    'config/tsconfig.node.json',
    'config/tsconfig.tc.web.json'
  ])
  expect(plan(['src/packages/process-host/src/run-process.ts']).typecheckProjects).toEqual([
    'config/tsconfig.node.json',
    'config/tsconfig.tc.web.json',
    'config/tsconfig.tc.cli.json',
    'src/packages/process-host/tsconfig.test.json'
  ])
})

it('keeps Vitest full-run triggers out of the related set and runs their colocated tests', () => {
  const listDirectory = (directory) =>
    directory === 'config/scripts/'
      ? ['foo.mjs', 'foo.test.mjs', 'foo.windows.test.mjs', 'foobar.test.mjs']
      : []
  expect(
    splitUnitTestInputs(
      ['package.json', 'config/scripts/foo.mjs', 'config/scripts/bar.test.mjs', 'src/main/a.ts'],
      listDirectory
    )
  ).toEqual({
    related: ['src/main/a.ts'],
    colocated: [
      'config/scripts/bar.test.mjs',
      'config/scripts/foo.test.mjs',
      'config/scripts/foo.windows.test.mjs'
    ]
  })
})

it('keeps high-fanout settings and localization inputs out of local related runs', () => {
  expect(
    splitUnitTestInputs([
      'src/shared/default-global-settings.ts',
      'src/shared/global-settings-types.ts',
      'src/renderer/src/i18n/en-runtime-required.json',
      'src/renderer/src/i18n/locales/en.json',
      'src/renderer/src/components/settings/AutomationsSettingsPane.tsx'
    ])
  ).toEqual({
    related: ['src/renderer/src/components/settings/AutomationsSettingsPane.tsx'],
    colocated: []
  })
})

it('falls back to changed and colocated tests when related inputs fan out', () => {
  const sources = Array.from({ length: 13 }, (_, index) => `src/main/feature-${index}.ts`)
  const listDirectory = (directory) =>
    directory === 'src/main/' ? ['feature-0.test.ts', 'feature-5.test.ts', 'unrelated.test.ts'] : []
  expect(splitUnitTestInputs([...sources, 'src/main/changed.test.ts'], listDirectory)).toEqual({
    related: [],
    colocated: [
      'src/main/changed.test.ts',
      'src/main/feature-0.test.ts',
      'src/main/feature-5.test.ts'
    ]
  })
})
