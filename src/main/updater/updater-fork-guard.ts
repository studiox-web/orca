import { app } from 'electron'

/**
 * XOS fork: release updates would replace this build with the upstream app and drop fork
 * features, so packaged fork builds behave like unpackaged builds for every update path.
 * Set ORCA_FORK_ALLOW_RELEASE_UPDATES=1 to restore upstream updating. Vitest keeps upstream
 * behavior so the upstream updater suites still exercise the real update paths.
 */
export function releaseUpdatesEnabled(): boolean {
  if (!app.isPackaged) {
    return false
  }
  return process.env.ORCA_FORK_ALLOW_RELEASE_UPDATES === '1' || process.env.VITEST === 'true'
}
