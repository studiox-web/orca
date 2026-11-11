import { realpathSync } from 'node:fs'
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
  runtime: object
  store: RuntimeStore | null
  generation: () => string
  isLocalDesktop: () => boolean
  readInProcessProvider: () => object
}
type Admission = {
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
  runtime: object
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
}): NativeProviderExecutionAdmission {
  const admission: Admission = {
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
}

function assertAdmissionCurrent(admission: Admission): void {
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

function assertAdmissionBinding(admission: Admission, runtime: object): void {
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
}> {
  const admission = admissions.get(candidate)
  if (!admission || admission.binding?.store !== store) {
    throw new Error('native_provider_admission_invalid')
  }
  assertAdmissionBinding(admission, runtime)
  return {
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
  runtime?: object
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
