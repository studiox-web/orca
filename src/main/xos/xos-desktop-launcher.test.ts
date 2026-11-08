import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let home: string
let profile: string
let app: string
const launcher = resolve(__dirname, '../../../xos/orcad/orca-xos-desktop.sh')

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'xos-launch-'))
  profile = join(home, '.config', 'orca')
  mkdirSync(profile, { recursive: true })
  app = join(home, 'app')
  writeFileSync(app, '#!/bin/bash\nprintf "%s:%s" "$ORCA_XOS_LOCAL_SCHEDULER" "$*"\n')
  chmodSync(app, 0o755)
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

function run() {
  return spawnSync('bash', [launcher, 'orca://example'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      ORCA_USER_DATA_PATH: profile,
      ORCA_XOS_APPIMAGE: app,
      ORCA_BACKGROUND_LAUNCH: '1'
    }
  })
}

function lock(role: string, pid = process.pid) {
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
  writeFileSync(
    join(profile, 'orcad.lock'),
    JSON.stringify({
      pid,
      role,
      bootId: readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(),
      linuxStartTicks: stat
        .slice(stat.lastIndexOf(')') + 1)
        .trim()
        .split(/\s+/)[19]
    })
  )
}

describe.skipIf(process.platform !== 'linux')('XOS desktop launcher', () => {
  it('launches a free profile with scheduling continuity and unchanged arguments', () => {
    const result = run()
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('1:orca://example')
  })
  it('forwards activation to a verified desktop without touching the service', () => {
    lock('desktop')
    expect(run().status).toBe(0)
  })
  it('refuses a server owner without stopping jobs or deleting the lock', () => {
    lock('orcad')
    const before = readFileSync(join(profile, 'orcad.lock'), 'utf8')
    const result = run()
    expect(result.status).toBe(75)
    expect(result.stderr).toContain('no service was stopped')
    expect(readFileSync(join(profile, 'orcad.lock'), 'utf8')).toBe(before)
  })
  it('recognizes Electron-style serve argv even with the desktop lock role', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '--', '--serve'])
    try {
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', resolve)
        child.once('error', reject)
      })
      lock('desktop', child.pid!)
      expect(run().status).toBe(75)
    } finally {
      child.kill()
      await new Promise<void>((resolve) => child.once('exit', () => resolve()))
    }
  })
  it('fails closed on malformed lock data or unverifiable identity', () => {
    writeFileSync(join(profile, 'orcad.lock'), '{')
    expect(run().status).toBe(75)
    writeFileSync(
      join(profile, 'orcad.lock'),
      JSON.stringify({ pid: process.pid, role: 'desktop' })
    )
    expect(run().status).toBe(75)
  })
})
