import { realpathSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'
import type {
  MainProcessRuntimeCompositionFactory,
  MainProcessRuntimeComposition
} from '../../../src/main/startup/main-process-runtime-composition'
import { createDefaultFakeNoEffectsWorkerProvider } from '../../../src/main/automations/coordinated-automation-task-execution'
import { COORDINATED_FAKE_RUNS_CAPABILITY } from '../../../src/main/automations/coordinated-automation-run-host-types'
import { normalizeRuntimePathForComparison } from '../../../src/shared/cross-platform-path'

type IsolatedAppEnvironment = {
  isPackaged: () => boolean
  userDataDirectory: () => string
  homeDirectory: () => string
  backgroundLaunch: () => boolean
}

function canonical(directory: string): string {
  if (!isAbsolute(directory)) {
    throw new Error('The isolated composition requires an absolute directory.')
  }
  return normalizeRuntimePathForComparison(realpathSync(directory))
}

/** A separate entry owns this opt-in; ordinary builds never import this fixture. */
export function createIsolatedCoordinatedAppComposition(input: {
  userDataDirectory: string
  homeDirectory: string
  environment: IsolatedAppEnvironment
}) {
  const userData = canonical(input.userDataDirectory)
  const home = canonical(input.homeDirectory)
  if (home !== canonical(join(userData, 'home'))) {
    throw new Error('The isolated HOME must belong to this disposable userData directory.')
  }
  return ({
    store,
    headless
  }: Parameters<MainProcessRuntimeCompositionFactory>[0]): MainProcessRuntimeComposition => {
    const environment = input.environment
    if (
      environment.isPackaged() ||
      headless ||
      !environment.backgroundLaunch() ||
      canonical(environment.userDataDirectory()) !== userData ||
      canonical(environment.homeDirectory()) !== home
    ) {
      throw new Error('Coordinated app composition requires an isolated hidden local desktop.')
    }
    const profileDirectory = canonical(store.getProfileStorageDirectory())
    const profileRelative = relative(canonical(join(userData, 'profiles')), profileDirectory)
    if (
      !profileRelative ||
      profileRelative.startsWith(`..${sep}`) ||
      isAbsolute(profileRelative) ||
      profileRelative === '..'
    ) {
      throw new Error('The active Store must be a profile within this isolated userData directory.')
    }
    return {
      coordinatedDefinitionWrites: { profileDirectory },
      coordinatedRuns: ({ runtime }) => ({
        capability: COORDINATED_FAKE_RUNS_CAPABILITY,
        profile: { kind: 'isolated_test', root: profileDirectory },
        orchestrationDb: runtime.getOrchestrationDb(),
        workerProvider: createDefaultFakeNoEffectsWorkerProvider(store),
        clock: {
          now: () => Date.now(),
          setTimer: (delayMs, callback) => {
            const timer = setTimeout(callback, delayMs)
            return () => clearTimeout(timer)
          }
        },
        laneLocks: {
          tryAcquire: () => ({ acquired: false, holder: 'isolated read-only worker fixture' })
        },
        effects: { policy: 'deny' }
      })
    }
  }
}
