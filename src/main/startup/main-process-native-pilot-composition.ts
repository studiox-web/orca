import { realpathSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'
import { getAppEnvironment } from '../../shared/app-environment'
import { createNativePilotPromptResolver } from '../automations/coordinated-automation-native-pilot-prompts'
import { COORDINATED_NATIVE_PROVIDER_CAPABILITY } from '../automations/coordinated-automation-native-provider-plan'
import { createCoordinatedNativeProviderWorker } from '../automations/coordinated-automation-native-provider-worker'
import type {
  CoordinatedWorkerProvider,
  CoordinatedLaneLockProvider
} from '../automations/coordinated-automation-recovery-context'
import {
  createNativeProviderExecutionAdmission,
  type NativeProviderPilotScope
} from '../runtime/native-provider-execution-admission'
import type {
  MainProcessRuntimeCompositionFactory,
  MainProcessRuntimeComposition
} from './main-process-runtime-composition'

/** Separate trusted entry only; the ordinary app never supplies this factory or a sandbox policy. */
export function createIsolatedNativeCoordinatedAppComposition(input: {
  userDataDirectory: string
  pilotScope: NativeProviderPilotScope
  laneLocks: CoordinatedLaneLockProvider
  estimateCostUsd: NonNullable<CoordinatedWorkerProvider['estimateCostUsd']>
}) {
  const scope = Object.freeze({
    ...input.pilotScope,
    workspacePath: realpathSync(input.pilotScope.workspacePath),
    inputRoot: realpathSync(input.pilotScope.inputRoot),
    homeDirectory: realpathSync(input.pilotScope.homeDirectory)
  })
  return ({
    store,
    headless
  }: Parameters<MainProcessRuntimeCompositionFactory>[0]): MainProcessRuntimeComposition => {
    if (headless || getAppEnvironment().isPackaged()) {
      throw new Error('native_pilot_local_developer_host_required')
    }
    const profileDirectory = realpathSync(store.getProfileStorageDirectory())
    const profileRelative = relative(
      realpathSync(join(input.userDataDirectory, 'profiles')),
      profileDirectory
    )
    if (
      !profileRelative ||
      profileRelative === '..' ||
      profileRelative.startsWith(`..${sep}`) ||
      isAbsolute(profileRelative)
    ) {
      throw new Error('native_provider_profile_mismatch')
    }
    const admission = createNativeProviderExecutionAdmission({
      userDataDirectory: input.userDataDirectory,
      pilotScope: scope
    })
    const promptResolver = createNativePilotPromptResolver(scope)
    return {
      coordinatedNativeProviderExecution: admission,
      coordinatedDefinitionWrites: { profileDirectory },
      coordinatedRuns: ({ store: selectedStore, runtime }) => {
        if (selectedStore !== store) {
          throw new Error('native_pilot_store_changed')
        }
        const db = runtime.getOrchestrationDb()
        return {
          capability: COORDINATED_NATIVE_PROVIDER_CAPABILITY,
          profile: { kind: 'developer', root: profileDirectory },
          orchestrationDb: db,
          nativeProviderWorker: createCoordinatedNativeProviderWorker({
            runtime,
            store,
            db,
            admission
          }),
          workspacePath: scope.workspacePath,
          promptResolver,
          clock: {
            now: () => Date.now(),
            setTimer: (delayMs, callback) => {
              const timer = setTimeout(callback, delayMs)
              return () => clearTimeout(timer)
            }
          },
          laneLocks: input.laneLocks,
          estimateCostUsd: input.estimateCostUsd,
          effects: { policy: 'deny' }
        }
      }
    }
  }
}
