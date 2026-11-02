import { open, stat } from 'node:fs/promises'
import type { CrontabEntry, CrontabRunEvidence } from './external-crontab-jobs'

const LOG_TAIL_BYTES = 4 * 1024
const LOG_PREVIEW_LINES = 12

async function readTail(path: string): Promise<string | null> {
  const handle = await open(path, 'r')
  try {
    const { size } = await handle.stat()
    const length = Math.min(size, LOG_TAIL_BYTES)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, size - length)
    const lines = buffer
      .toString('utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim())
    return lines.slice(-LOG_PREVIEW_LINES).join('\n') || null
  } finally {
    await handle.close()
  }
}

/** Uses the job's own redirected log: its mtime is the last write and its tail the last output. */
export async function readCrontabLogEvidence(
  entry: CrontabEntry
): Promise<CrontabRunEvidence | null> {
  if (!entry.logPath) {
    return null
  }
  try {
    const info = await stat(entry.logPath)
    const lastRunAt = info.mtime.toISOString()
    const tail = await readTail(entry.logPath)
    return {
      lastRunAt,
      lastStatus: null,
      lastError: null,
      runs: [
        {
          id: `${entry.id}:${lastRunAt}`,
          runAt: lastRunAt,
          status: 'unknown',
          outputPreview: tail,
          outputContent: null,
          error: null,
          outputPath: entry.logPath
        }
      ]
    }
  } catch {
    return null
  }
}
