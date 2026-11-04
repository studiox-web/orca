import { rmSync } from 'node:fs'
import { waitForProjectHomeCommits } from './xos-project-home'

/** Project-home commits run in the background; deleting under one fails the next test. */
export async function removeTempDir(path: string): Promise<void> {
  await waitForProjectHomeCommits()
  rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
}
