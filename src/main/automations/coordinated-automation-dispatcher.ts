import { join } from 'node:path'
import { getAppEnvironment } from '../../shared/app-environment'
import { isCoordinatedAutomation } from '../../shared/coordinated-automation-types'
import type { CoordinatedAutomationAdapter } from './coordinated-automation-adapter'
import {
  createFileCoordinatedRunProgressStore,
  type CoordinatedRunProgressStore
} from './coordinated-automation-progress-store'
import type { HeadlessAutomationDispatcher } from './headless-dispatch'

export const defaultCoordinatedProgressStore = (): CoordinatedRunProgressStore =>
  createFileCoordinatedRunProgressStore(
    join(getAppEnvironment().getPath('userData'), 'coordinated-automation-progress')
  )

export function createCoordinatedAutomationDispatcher(
  adapter: CoordinatedAutomationAdapter,
  fallbackDispatcher?: HeadlessAutomationDispatcher
): HeadlessAutomationDispatcher {
  return async (request) => {
    if (!isCoordinatedAutomation(request.automation)) {
      if (!fallbackDispatcher) {
        throw new Error('No fallback dispatcher provided for single automation.')
      }
      return fallbackDispatcher(request)
    }
    return adapter.dispatch(request)
  }
}
