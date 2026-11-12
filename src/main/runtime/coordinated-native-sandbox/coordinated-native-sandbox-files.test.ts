import { afterEach, expect, it, vi } from 'vitest'
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sandboxInputDigest } from './coordinated-native-sandbox-files'
import type { PreparedNativeProviderLaunch } from '../native-provider-execution-admission'
import {
  assertCoordinatedNativeSandboxCurrent,
  assertCoordinatedNativeSandboxSpawnPlan,
  createCoordinatedNativeSandboxPolicy,
  registerCoordinatedNativeSandboxAttempt,
  type CoordinatedNativeSandboxPolicy
} from './coordinated-native-sandbox-policy'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

it('pins an issued policy to input bytes, executable bytes, the profile and exact physical spawn', async () => {
  const { root } = fixture()
  const homeDirectory = join(root, 'home')
  const workspacePath = join(root, 'workspace')
  const inputRoot = join(workspacePath, 'inputs')
  const outputRoot = join(workspacePath, 'outputs')
  const profileDirectory = join(root, 'profiles', 'one')
  const otherProfile = join(root, 'profiles', 'two')
  for (const path of [homeDirectory, inputRoot, outputRoot, profileDirectory, otherProfile]) {
    mkdirSync(path, { recursive: true })
  }
  const executable = join(root, 'executable')
  writeFileSync(executable, 'host-owned executable fixture')
  const brief = join(inputRoot, 'brief')
  writeFileSync(brief, 'original input')
  const scope = {
    userDataDirectory: root,
    homeDirectory,
    workspaceId: 'folder:pilot',
    workspacePath
  }
  const policy = createCoordinatedNativeSandboxPolicy({
    scope,
    launch: {
      inputRoot,
      outputRoot,
      codexBinary: executable,
      nodeBinary: executable,
      helperFile: executable,
      authFile: executable,
      outputFiles: { writer: [join(outputRoot, 'draft')] }
    }
  })
  assertCoordinatedNativeSandboxCurrent(policy, { ...scope, profileDirectory })
  expect(() =>
    assertCoordinatedNativeSandboxCurrent(policy, { ...scope, profileDirectory: otherProfile })
  ).toThrow('coordinated_native_sandbox_profile_changed')
  const permit: PreparedNativeProviderLaunch = { capability: 'coordinated_native_provider_attempt' }
  const spawn = {
    shellPath: executable,
    shellArgs: ['--strict-config'],
    cwd: workspacePath,
    env: { HOME: homeDirectory },
    hasFallback: false
  }
  const cleanup = vi.fn(async () => {})
  registerCoordinatedNativeSandboxAttempt(policy, permit, { spawn, assertCurrent() {}, cleanup })
  assertCoordinatedNativeSandboxSpawnPlan(policy, permit, spawn)
  expect(() => assertCoordinatedNativeSandboxSpawnPlan(policy, { ...permit }, spawn)).toThrow(
    'coordinated_native_sandbox_final_spawn_changed'
  )
  expect(() =>
    assertCoordinatedNativeSandboxSpawnPlan(policy, permit, {
      ...spawn,
      env: { ...spawn.env, NODE_OPTIONS: 'foreign' }
    })
  ).toThrow('coordinated_native_sandbox_final_spawn_changed')
  expect(() =>
    assertCoordinatedNativeSandboxSpawnPlan(policy, permit, { ...spawn, hasFallback: true })
  ).toThrow('coordinated_native_sandbox_final_spawn_changed')
  writeFileSync(brief, 'changed input')
  expect(() => assertCoordinatedNativeSandboxSpawnPlan(policy, permit, spawn)).toThrow(
    'coordinated_native_sandbox_input_changed'
  )
  writeFileSync(brief, 'original input')
  writeFileSync(executable, 'changed executable')
  expect(() => assertCoordinatedNativeSandboxSpawnPlan(policy, permit, spawn)).toThrow(
    'coordinated_native_sandbox_file_changed'
  )
  await policy.dispose()
  expect(cleanup).toHaveBeenCalledOnce()
  expect(() => assertCoordinatedNativeSandboxSpawnPlan(policy, permit, spawn)).toThrow(
    'coordinated_native_sandbox_policy_unavailable'
  )
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'orca-policy-'))
  roots.push(root)
  const input = join(root, 'input')
  mkdirSync(input)
  writeFileSync(join(input, 'brief.txt'), 'frozen reference')
  return { root, input }
}

it('detects changed input bytes and refuses linked content or agent configuration', () => {
  const { root, input } = fixture()
  const first = sandboxInputDigest(input)
  writeFileSync(join(input, 'brief.txt'), 'changed reference')
  expect(sandboxInputDigest(input)).not.toBe(first)
  writeFileSync(join(root, 'outside'), 'not an input')
  symlinkSync(join(root, 'outside'), join(input, 'linked'))
  expect(() => sandboxInputDigest(input)).toThrow('coordinated_native_sandbox_input_link_or_device')
  rmSync(join(input, 'linked'))
  linkSync(join(root, 'outside'), join(input, 'linked'))
  expect(() => sandboxInputDigest(input)).toThrow('coordinated_native_sandbox_input_link_or_device')
  rmSync(join(input, 'linked'))
  mkdirSync(join(input, '.codex'))
  expect(() => sandboxInputDigest(input)).toThrow(
    'coordinated_native_sandbox_configuration_in_input'
  )
})

it('does not let a manifest or serialized verification assertion authorize a physical spawn', () => {
  const { root, input } = fixture()
  const claimed: CoordinatedNativeSandboxPolicy = JSON.parse(
    JSON.stringify({
      capability: 'coordinated_native_sandbox',
      verified: true,
      runnable: true,
      inputRoot: input,
      inputDigest: sandboxInputDigest(input),
      provider: 'codex'
    })
  )
  expect(() =>
    assertCoordinatedNativeSandboxCurrent(claimed, {
      userDataDirectory: root,
      workspaceId: 'folder:fixture',
      workspacePath: input,
      homeDirectory: root
    })
  ).toThrow('coordinated_native_sandbox_policy_unavailable')
  expect(() =>
    assertCoordinatedNativeSandboxSpawnPlan(
      claimed,
      { capability: 'coordinated_native_provider_attempt' },
      {
        shellPath: '/usr/bin/bash',
        shellArgs: ['-lc', 'codex --dangerously-bypass-approvals-and-sandbox'],
        cwd: input,
        env: { CODEX_HOME: root, NODE_OPTIONS: '--import=/outside.js' },
        hasFallback: false
      }
    )
  ).toThrow('coordinated_native_sandbox_policy_unavailable')
})
