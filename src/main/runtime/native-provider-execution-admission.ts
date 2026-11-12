import {
  assertCoordinatedNativeSandboxCurrent,
  type CoordinatedNativeSandboxPolicy
} from './coordinated-native-sandbox/coordinated-native-sandbox-policy'
import { bindCoordinatedNativeSandbox } from './coordinated-native-sandbox/coordinated-native-sandbox-launch'
import type { OrcaRuntimeWithStateFields } from './construction/runtime-construction'
import { realpathSync } from 'node:fs'
import { normalizeWorkspaceSessionKeyToWorkspaceId } from '../../shared/workspace-scope'
import { isAbsolute, join, relative, sep } from 'node:path'
import { getAppEnvironment } from '../../shared/app-environment'
import type { RuntimeStore } from './runtime-store-contract'
import type { OrcaRuntimeService } from './orca-runtime'
import type { TuiAgent } from '../../shared/tui-agent'
import type { SleepingAgentLaunchConfig } from '../../shared/agent-session/lifecycle/agent-session-resume'

export type NativeProviderExecutionAdmission = Readonly<{
  capability: 'coordinated_native_provider_execution'
  revoke(): void
}>
export type PreparedNativeProviderLaunch = Readonly<{
  capability: 'coordinated_native_provider_attempt'
}>

type Binding = {
  runtime: OrcaRuntimeWithStateFields
  store: RuntimeStore | null
  generation: () => string
  isLocalDesktop: () => boolean
  readInProcessProvider: () => object
}
export type NativeProviderPilotScope = Readonly<{
  homeDirectory: string
  workspaceId: string
  workspacePath: string
  inputRoot: string
  promptAuthority: string
  idempotencyKey: string
  sandboxPolicy: CoordinatedNativeSandboxPolicy
}>

type Admission = {
  pilotScope?: NativeProviderPilotScope
  environment: ReturnType<typeof getAppEnvironment>
  userData: string
  revoked: boolean
  binding?: Binding
  profile?: string
  generation?: string
  provider?: object
}
type Permit = {
  admission: Admission
  runtime: OrcaRuntimeService
  runId: string
  taskId: string
  dispatchId: string
  assertCurrent: () => void
  consumed: boolean
  selection: Readonly<{
    workspaceId: string
    path: string
    agent: TuiAgent
    model: string | null
    effort: string | null
  }>
  phase: 'prepared' | 'creating' | 'dispatched'
  command?: string
  launchConfig?: SleepingAgentLaunchConfig
}

const admissions = new WeakMap<NativeProviderExecutionAdmission, Admission>()
const runtimeAdmissions = new WeakMap<OrcaRuntimeWithStateFields, Admission>()
const permits = new WeakMap<PreparedNativeProviderLaunch, Permit>()

function canonical(path: string): string {
  if (!isAbsolute(path)) {
    throw new Error('native_provider_absolute_path_required')
  }
  return realpathSync(path)
}

function within(root: string, path: string): boolean {
  const child = relative(root, path)
  return !!child && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
}

/** Only an isolated, process-local host composition can admit normal-provider execution. */
export function createNativeProviderExecutionAdmission(input: {
  userDataDirectory: string
  pilotScope?: NativeProviderPilotScope
}): NativeProviderExecutionAdmission {
  const admission: Admission = {
    pilotScope: input.pilotScope
      ? Object.freeze({
          ...input.pilotScope,
          homeDirectory: canonical(input.pilotScope.homeDirectory),
          workspacePath: canonical(input.pilotScope.workspacePath),
          inputRoot: canonical(input.pilotScope.inputRoot)
        })
      : undefined,
    environment: getAppEnvironment(),
    userData: canonical(input.userDataDirectory),
    revoked: false
  }
  const result: NativeProviderExecutionAdmission = Object.freeze({
    capability: 'coordinated_native_provider_execution',
    revoke() {
      admission.revoked = true
    },
    toJSON() {
      throw new Error('native_provider_admission_is_process_local')
    }
  })
  admissions.set(result, admission)
  assertAdmissionCurrent(admission)
  return result
}

export function bindNativeProviderExecutionAdmission(
  candidate: NativeProviderExecutionAdmission | undefined,
  binding: Binding
): void {
  if (!candidate) {
    return
  }
  const admission = admissions.get(candidate)
  if (!admission || admission.binding) {
    throw new Error('native_provider_admission_invalid')
  }
  assertAdmissionCurrent(admission)
  const profile = binding.store?.getProfileStorageDirectory?.()
  if (!profile || !within(canonical(join(admission.userData, 'profiles')), canonical(profile))) {
    throw new Error('native_provider_profile_mismatch')
  }
  admission.provider = binding.readInProcessProvider()
  admission.binding = binding
  admission.profile = canonical(profile)
  admission.generation = binding.generation()
  assertAdmissionBinding(admission, binding.runtime)
  runtimeAdmissions.set(binding.runtime, admission)
}

export function nativePilotRequiresInProcessPty(runtime: OrcaRuntimeWithStateFields): boolean {
  const admission = runtimeAdmissions.get(runtime)
  if (!admission?.pilotScope) {
    return false
  }
  assertAdmissionBinding(admission, runtime)
  return true
}

function assertAdmissionCurrent(admission: Admission): void {
  const scope = admission.pilotScope
  if (scope) {
    if (
      !scope.workspaceId ||
      !scope.promptAuthority ||
      !scope.idempotencyKey ||
      scope.idempotencyKey.length > 128 ||
      canonical(scope.homeDirectory) !== canonical(join(admission.userData, 'home')) ||
      canonical(admission.environment.getPath('home')) !== canonical(scope.homeDirectory) ||
      !within(admission.userData, canonical(scope.workspacePath)) ||
      !within(canonical(scope.workspacePath), canonical(scope.inputRoot))
    ) {
      throw new Error('native_provider_pilot_scope_mismatch')
    }
    assertCoordinatedNativeSandboxCurrent(scope.sandboxPolicy, {
      userDataDirectory: admission.userData,
      profileDirectory: admission.profile,
      homeDirectory: canonical(scope.homeDirectory),
      workspaceId: scope.workspaceId,
      workspacePath: canonical(scope.workspacePath)
    })
  }
  if (
    admission.revoked ||
    getAppEnvironment() !== admission.environment ||
    admission.environment.isPackaged() ||
    process.env.ORCA_BACKGROUND_LAUNCH !== '1' ||
    canonical(admission.environment.getPath('userData')) !== admission.userData
  ) {
    throw new Error('native_provider_admission_unavailable')
  }
}

function assertAdmissionBinding(admission: Admission, runtime: OrcaRuntimeWithStateFields): void {
  assertAdmissionCurrent(admission)
  const binding = admission.binding
  if (
    !binding ||
    binding.runtime !== runtime ||
    binding.generation() !== admission.generation ||
    binding.readInProcessProvider() !== admission.provider ||
    canonical(binding.store?.getProfileStorageDirectory?.() ?? '') !== admission.profile
  ) {
    throw new Error('native_provider_runtime_or_profile_changed')
  }
}

export function assertNativeProviderExecutionAdmission(
  candidate: NativeProviderExecutionAdmission,
  runtime: OrcaRuntimeService,
  store: RuntimeStore
): Readonly<{
  profile: string
  generation: string
  hostKind: 'local_desktop' | 'headless_daemon'
  pilotScope?: NativeProviderPilotScope
}> {
  const admission = admissions.get(candidate)
  if (!admission || admission.binding?.store !== store) {
    throw new Error('native_provider_admission_invalid')
  }
  assertAdmissionBinding(admission, runtime)
  return {
    pilotScope: admission.pilotScope,
    profile: admission.profile!,
    generation: admission.generation!,
    hostKind: admission.binding!.isLocalDesktop() ? 'local_desktop' : 'headless_daemon'
  }
}

/** The permit names the already-allocated Dispatch; it cannot create or retarget one. */
export function prepareNativeProviderLaunch(input: {
  admission: NativeProviderExecutionAdmission
  runtime: OrcaRuntimeService
  runId: string
  taskId: string
  dispatchId: string
  selection: Permit['selection']
  assertCurrent: () => void
}): PreparedNativeProviderLaunch {
  const admission = admissions.get(input.admission)
  if (!admission) {
    throw new Error('native_provider_admission_invalid')
  }
  assertAdmissionBinding(admission, input.runtime)
  input.assertCurrent()
  const scope = admission.pilotScope
  if (
    scope &&
    (input.selection.workspaceId !== normalizeWorkspaceSessionKeyToWorkspaceId(scope.workspaceId) ||
      canonical(input.selection.path) !== canonical(scope.workspacePath) ||
      input.selection.agent !== 'codex')
  ) {
    throw new Error('native_provider_pilot_selection_mismatch')
  }
  const permit: PreparedNativeProviderLaunch = Object.freeze({
    capability: 'coordinated_native_provider_attempt',
    toJSON() {
      throw new Error('native_provider_permit_is_process_local')
    }
  })
  permits.set(permit, {
    ...input,
    selection: Object.freeze({ ...input.selection }),
    admission,
    consumed: false,
    phase: 'prepared'
  })
  if (scope) {
    bindCoordinatedNativeSandbox(permit, scope.sandboxPolicy)
  }
  return permit
}

export function consumeNativeProviderLaunch(
  candidate: PreparedNativeProviderLaunch,
  input: { runtime: OrcaRuntimeService; runId: string; taskId: string; dispatchId: string }
): void {
  const permit = permits.get(candidate)
  if (
    !permit ||
    permit.consumed ||
    permit.runtime !== input.runtime ||
    permit.runId !== input.runId ||
    permit.taskId !== input.taskId ||
    permit.dispatchId !== input.dispatchId
  ) {
    throw new Error('native_provider_permit_mismatch')
  }
  assertAdmissionBinding(permit.admission, input.runtime)
  permit.assertCurrent()
  permit.consumed = true
}

export function requireNativeProviderLaunch(
  candidate: PreparedNativeProviderLaunch,
  runtime?: OrcaRuntimeWithStateFields
): Permit {
  const permit = permits.get(candidate)
  if (
    !permit ||
    !permit.consumed ||
    !permit.admission.binding?.isLocalDesktop() ||
    (runtime && permit.runtime !== runtime)
  ) {
    throw new Error('native_provider_permit_mismatch')
  }
  assertAdmissionBinding(permit.admission, permit.runtime)
  permit.assertCurrent()
  return permit
}

export function isDispatchedNativeProviderLaunch(
  candidate: PreparedNativeProviderLaunch | undefined
): boolean {
  return !!candidate && permits.get(candidate)?.phase === 'dispatched'
}

export function markNativeProviderDispatched(candidate: PreparedNativeProviderLaunch): void {
  const permit = permits.get(candidate)
  if (!permit || permit.phase !== 'creating') {
    throw new Error('native_provider_permit_mismatch')
  }
  permit.phase = 'dispatched'
}
