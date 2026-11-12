import {
  requireNativeProviderLaunch,
  type PreparedNativeProviderLaunch
} from '../native-provider-execution-admission'
import {
  assertCoordinatedNativeSandboxSpawnPlan,
  type CoordinatedNativeSandboxPolicy,
  type CoordinatedNativeSandboxPhysicalSpawn
} from './coordinated-native-sandbox-policy'

const bindings = new WeakMap<PreparedNativeProviderLaunch, CoordinatedNativeSandboxPolicy>()

export function bindCoordinatedNativeSandbox(
  permit: PreparedNativeProviderLaunch,
  policy: CoordinatedNativeSandboxPolicy
): void {
  if (bindings.has(permit)) {
    throw new Error('coordinated_native_sandbox_already_bound')
  }
  bindings.set(permit, policy)
}

export function requireCoordinatedNativeSandbox(
  permit: PreparedNativeProviderLaunch
): CoordinatedNativeSandboxPolicy | undefined {
  const native = requireNativeProviderLaunch(permit)
  const scope = native.admission.pilotScope
  const policy = bindings.get(permit)
  if (!scope) {
    if (policy) {
      throw new Error('coordinated_native_sandbox_unscoped_binding')
    }
    return undefined
  }
  if (!policy || policy !== scope.sandboxPolicy || native.selection.agent !== 'codex') {
    throw new Error('coordinated_native_sandbox_binding_missing')
  }
  return policy
}

export function assertCoordinatedNativeSandboxPhysicalSpawn(
  permit: PreparedNativeProviderLaunch,
  spawn: CoordinatedNativeSandboxPhysicalSpawn
): void {
  const policy = requireCoordinatedNativeSandbox(permit)
  if (policy) {
    assertCoordinatedNativeSandboxSpawnPlan(policy, permit, spawn)
  }
}
