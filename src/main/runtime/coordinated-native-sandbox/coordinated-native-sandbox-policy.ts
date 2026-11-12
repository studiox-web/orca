import { isDeepStrictEqual } from 'node:util'
import { lstatSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { fileStatSignature } from '../../file-stat-signature'
import type { PreparedNativeProviderLaunch } from '../native-provider-execution-admission'
import {
  canonicalSandboxPath,
  sandboxDescendant,
  sandboxFileDigest,
  sandboxInputDigest
} from './coordinated-native-sandbox-files'

const sandboxPolicyBrand: unique symbol = Symbol('coordinated-native-sandbox')
export type CoordinatedNativeSandboxPolicy = Readonly<{
  [sandboxPolicyBrand]: true
  revoke(): void
  dispose(): Promise<void>
}>

export type CoordinatedNativeSandboxScope = Readonly<{
  userDataDirectory: string
  profileDirectory?: string
  workspaceId: string
  workspacePath: string
  homeDirectory: string
}>

type PolicyRecord = {
  scope: CoordinatedNativeSandboxScope
  revoked: boolean
  inputRoot: string
  inputDigest: string
  files: ReadonlyMap<string, { digest: string; signature: string }>
  launch: CoordinatedNativeSandboxLaunchFiles
  attempts: Map<
    PreparedNativeProviderLaunch,
    { spawn: CoordinatedNativeSandboxPhysicalSpawn; assertCurrent(): void }
  >
  cleanup: Set<() => Promise<void>>
}

export type CoordinatedNativeSandboxLaunchFiles = Readonly<{
  inputRoot: string
  outputRoot: string
  codexBinary: string
  nodeBinary: string
  helperFile: string
  authFile: string
  outputFiles: Readonly<Record<string, readonly string[]>>
  revisionDirectories?: Readonly<Record<string, string>>
}>

export type CoordinatedNativeSandboxPhysicalSpawn = Readonly<{
  shellPath: string
  shellArgs: readonly string[]
  cwd: string
  env: Readonly<Record<string, string>>
  hasFallback: boolean
}>

const policies = new WeakMap<CoordinatedNativeSandboxPolicy, PolicyRecord>()

export function createCoordinatedNativeSandboxPolicy(input: {
  scope: CoordinatedNativeSandboxScope
  launch: CoordinatedNativeSandboxLaunchFiles
}): CoordinatedNativeSandboxPolicy {
  const scope = Object.freeze({ ...input.scope })
  const launch = structuredClone(input.launch)
  for (const path of [
    scope.userDataDirectory,
    scope.homeDirectory,
    scope.workspacePath,
    launch.inputRoot,
    launch.outputRoot,
    launch.codexBinary,
    launch.nodeBinary,
    launch.helperFile,
    launch.authFile
  ]) {
    canonicalSandboxPath(path)
  }
  if (
    process.platform !== 'linux' ||
    !scope.workspaceId ||
    scope.homeDirectory !== join(scope.userDataDirectory, 'home') ||
    !sandboxDescendant(scope.userDataDirectory, scope.workspacePath) ||
    !sandboxDescendant(scope.workspacePath, launch.inputRoot) ||
    !sandboxDescendant(scope.workspacePath, launch.outputRoot) ||
    sandboxDescendant(launch.inputRoot, launch.outputRoot) ||
    sandboxDescendant(launch.outputRoot, launch.inputRoot) ||
    launch.inputRoot === launch.outputRoot
  ) {
    throw new Error('coordinated_native_sandbox_scope_invalid')
  }
  const outputs = new Set<string>()
  for (const path of Object.values(launch.revisionDirectories ?? {})) {
    canonicalSandboxPath(path)
    if (!sandboxDescendant(launch.outputRoot, path)) {
      throw new Error('coordinated_native_sandbox_revision_scope_invalid')
    }
  }
  for (const files of Object.values(launch.outputFiles)) {
    if (!files.length) {
      throw new Error('coordinated_native_sandbox_output_required')
    }
    for (const path of files) {
      if (!isAbsolute(path) || !sandboxDescendant(launch.outputRoot, path) || outputs.has(path)) {
        throw new Error('coordinated_native_sandbox_output_scope_invalid')
      }
      outputs.add(path)
    }
  }
  const record: PolicyRecord = {
    scope,
    launch,
    revoked: false,
    inputRoot: launch.inputRoot,
    inputDigest: sandboxInputDigest(launch.inputRoot),
    files: new Map(
      [launch.codexBinary, launch.nodeBinary, launch.helperFile].map((path) => {
        const signature = fileStatSignature(lstatSync(path, { bigint: true }))
        const digest = sandboxFileDigest(path)
        if (fileStatSignature(lstatSync(path, { bigint: true })) !== signature) {
          throw new Error('coordinated_native_sandbox_file_changed')
        }
        return [path, { digest, signature }]
      })
    ),
    attempts: new Map(),
    cleanup: new Set()
  }
  const policy: CoordinatedNativeSandboxPolicy = Object.freeze({
    [sandboxPolicyBrand]: true,
    revoke() {
      record.revoked = true
    },
    async dispose() {
      record.revoked = true
      await Promise.all([...record.cleanup].map((cleanup) => cleanup()))
      record.cleanup.clear()
    }
  })
  policies.set(policy, record)
  assertCoordinatedNativeSandboxCurrent(policy, scope)
  return policy
}

export function readCoordinatedNativeSandboxLaunch(policy: CoordinatedNativeSandboxPolicy) {
  const record = policies.get(policy)
  if (!record) {
    throw new Error('coordinated_native_sandbox_policy_unavailable')
  }
  assertCoordinatedNativeSandboxCurrent(policy, record.scope)
  return { scope: record.scope, launch: structuredClone(record.launch) }
}

export function registerCoordinatedNativeSandboxAttempt(
  policy: CoordinatedNativeSandboxPolicy,
  permit: PreparedNativeProviderLaunch,
  attempt: {
    spawn: CoordinatedNativeSandboxPhysicalSpawn
    assertCurrent(): void
    cleanup(): Promise<void>
  }
): void {
  const record = policies.get(policy)
  if (!record || record.attempts.has(permit)) {
    throw new Error('coordinated_native_sandbox_attempt_unavailable')
  }
  assertCoordinatedNativeSandboxCurrent(policy, record.scope)
  attempt.assertCurrent()
  record.attempts.set(permit, {
    spawn: structuredClone(attempt.spawn),
    assertCurrent: attempt.assertCurrent
  })
  record.cleanup.add(attempt.cleanup)
}

export function assertCoordinatedNativeSandboxSpawnPlan(
  policy: CoordinatedNativeSandboxPolicy,
  permit: PreparedNativeProviderLaunch,
  spawn: CoordinatedNativeSandboxPhysicalSpawn
): void {
  const record = policies.get(policy)
  if (!record) {
    throw new Error('coordinated_native_sandbox_policy_unavailable')
  }
  assertCoordinatedNativeSandboxCurrent(policy, record.scope)
  const attempt = record.attempts.get(permit)
  if (!attempt || spawn.hasFallback || !isDeepStrictEqual(spawn, attempt.spawn)) {
    throw new Error('coordinated_native_sandbox_final_spawn_changed')
  }
  attempt.assertCurrent()
}

export function assertCoordinatedNativeSandboxCurrent(
  policy: CoordinatedNativeSandboxPolicy,
  scope: CoordinatedNativeSandboxScope
): void {
  const record = policies.get(policy)
  if (process.platform !== 'linux' || !record || record.revoked) {
    throw new Error('coordinated_native_sandbox_policy_unavailable')
  }
  const expected = { ...record.scope, profileDirectory: undefined }
  const actual = { ...scope, profileDirectory: undefined }
  if (!isDeepStrictEqual(expected, actual)) {
    throw new Error('coordinated_native_sandbox_scope_changed')
  }
  for (const path of [scope.userDataDirectory, scope.homeDirectory, scope.workspacePath]) {
    canonicalSandboxPath(path)
  }
  if (scope.profileDirectory) {
    canonicalSandboxPath(scope.profileDirectory)
    if (
      !sandboxDescendant(join(scope.userDataDirectory, 'profiles'), scope.profileDirectory) ||
      (record.scope.profileDirectory && scope.profileDirectory !== record.scope.profileDirectory)
    ) {
      throw new Error('coordinated_native_sandbox_profile_changed')
    }
    if (!record.scope.profileDirectory) {
      record.scope = Object.freeze({ ...record.scope, profileDirectory: scope.profileDirectory })
    }
  }
  if (sandboxInputDigest(record.inputRoot) !== record.inputDigest) {
    throw new Error('coordinated_native_sandbox_input_changed')
  }
  for (const [path, pin] of record.files) {
    if (fileStatSignature(lstatSync(path, { bigint: true })) !== pin.signature) {
      throw new Error('coordinated_native_sandbox_file_changed')
    }
  }
}
