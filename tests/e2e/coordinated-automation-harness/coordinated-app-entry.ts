import { app } from 'electron'
import { startMainProcess } from '../../../src/main/main-process-bootstrap'
import { createIsolatedCoordinatedAppComposition } from './coordinated-app-composition'

const userDataDirectory = process.env.ORCA_E2E_USER_DATA_DIR
const homeDirectory = process.env.ORCA_E2E_HOME_DIR
if (
  !userDataDirectory ||
  !homeDirectory ||
  app.isPackaged ||
  process.env.ORCA_BACKGROUND_LAUNCH !== '1'
) {
  throw new Error('The coordinated fixture entry requires an isolated hidden unpackaged app.')
}
startMainProcess(
  createIsolatedCoordinatedAppComposition({
    userDataDirectory,
    homeDirectory,
    environment: {
      isPackaged: () => app.isPackaged,
      userDataDirectory: () => app.getPath('userData'),
      homeDirectory: () => app.getPath('home'),
      backgroundLaunch: () => process.env.ORCA_BACKGROUND_LAUNCH === '1'
    }
  })
)
