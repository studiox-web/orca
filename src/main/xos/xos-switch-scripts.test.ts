// XOS fork: H6, H7, L8. The switch scripts run as copies in a throwaway layout: fake systemctl and
// setsid first on PATH and a temp HOME, so they can't reach the real service, profile or AppImage.
import { spawn, spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const SOURCE = resolve(__dirname, '../../../xos')

let base: string
let home: string
let repo: string
let log: string

function fake(name: string, script: string): void {
  const path = join(base, 'bin', name)
  writeFileSync(path, `#!/bin/bash\n${script}\n`)
  chmodSync(path, 0o755)
}

function holdProfile(role: string, pid: number): void {
  const dir = join(home, '.config', 'orca')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'orcad.lock'), JSON.stringify({ pid, role }))
}

function runScript(name: string, args: string[] = []) {
  return spawnSync('/bin/bash', [join(repo, 'xos', name), ...args], {
    encoding: 'utf8',
    env: {
      PATH: `${join(base, 'bin')}${delimiter}/usr/bin${delimiter}/bin`,
      HOME: home,
      ORCA_OFFICIAL_APPIMAGE: join(base, 'Official.AppImage')
    }
  })
}

const calls = (): string => (existsSync(log) ? readFileSync(log, 'utf8') : '')

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'xos-switch-'))
  home = join(base, 'home')
  repo = join(base, 'repo')
  log = join(base, 'calls.log')
  mkdirSync(join(base, 'bin'))
  mkdirSync(join(home, '.config', 'orca'), { recursive: true })
  mkdirSync(join(repo, 'xos'), { recursive: true })
  mkdirSync(join(repo, 'dist'))
  for (const name of ['switch-to-fork.sh', 'switch-to-official.sh', 'profile-lock.sh']) {
    copyFileSync(join(SOURCE, name), join(repo, 'xos', name))
  }
  writeFileSync(join(repo, 'dist', 'orca-linux.AppImage'), 'not a real image')
  writeFileSync(join(base, 'Official.AppImage'), 'not a real image')
  chmodSync(join(base, 'Official.AppImage'), 0o755)
  fake('systemctl', `echo "systemctl $*" >> "${log}"`)
  fake('setsid', `echo "launched $*" >> "${log}"`)
  fake('update-desktop-database', 'true')
})

afterEach(() => rmSync(base, { recursive: true, force: true }))

describe('switch-to-fork.sh (H6)', () => {
  it('refuses while the desktop holds the profile, and leaves the service alone', () => {
    holdProfile('desktop', process.pid)
    const result = runScript('switch-to-fork.sh')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('still running')
    expect(calls()).not.toContain('stop')
    expect(existsSync(join(home, 'Applications', 'Orca-XOS.AppImage'))).toBe(false)
  })

  it('is not fooled by a dead lock, and installs and launches', async () => {
    holdProfile('desktop', 2 ** 22 + 1)
    const result = runScript('switch-to-fork.sh')
    expect(result.status).toBe(0)
    expect(existsSync(join(home, 'Applications', 'Orca-XOS.AppImage'))).toBe(true)
    await vi.waitFor(() => expect(calls()).toContain('launched'))
  })

  it('restarts the service it stopped when the switch fails after that point', () => {
    fake('tar', 'exit 1')
    const result = runScript('switch-to-fork.sh')
    expect(result.status).not.toBe(0)
    expect(calls()).toContain('systemctl --user stop orca-xos-serve.service')
    expect(calls()).toContain('systemctl --user start orca-xos-serve.service')
  })

  it('never stops the service when there is nothing to install', () => {
    rmSync(join(repo, 'dist', 'orca-linux.AppImage'))
    expect(runScript('switch-to-fork.sh').status).toBe(1)
    expect(calls()).not.toContain('stop')
  })

  // A real child must exit, and the script polls the lock once a second.
  it('with --wait, proceeds as soon as the app lets go of the profile', async () => {
    const app = spawn('sleep', ['1'], { stdio: 'ignore' })
    holdProfile('desktop', app.pid!)
    const result = await new Promise<number | null>((done) => {
      const child = spawn('/bin/bash', [join(repo, 'xos', 'switch-to-fork.sh'), '--wait=20'], {
        stdio: 'ignore',
        env: {
          PATH: `${join(base, 'bin')}${delimiter}/usr/bin${delimiter}/bin`,
          HOME: home
        }
      })
      child.on('close', done)
    })
    expect(result).toBe(0)
    await vi.waitFor(() => expect(calls()).toContain('launched'))
  }, 20_000)
})

describe('switch-to-official.sh (H7)', () => {
  it('refuses while the desktop runs, changing nothing', () => {
    holdProfile('desktop', process.pid)
    expect(runScript('switch-to-official.sh').status).toBe(1)
    expect(calls()).not.toContain('disable')
  })

  it('stops and disables the service before touching the profile', async () => {
    const backup = join(base, 'backup.tar.gz')
    spawnSync('tar', ['-czf', backup, '-C', join(home, '.config'), 'orca'])
    const result = runScript('switch-to-official.sh', [backup])
    expect(result.status).toBe(0)
    await vi.waitFor(() => expect(calls()).toContain('launched'))
    const order = calls()
    expect(order.indexOf('disable --now')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('disable --now')).toBeLessThan(order.indexOf('launched'))
    expect(result.stdout).toContain('Profile restored')
  })

  it('refuses a live orcad that outlives the stop, and re-enables the service', () => {
    holdProfile('orcad', process.pid)
    fake('sleep', 'exit 0')
    const backup = join(base, 'backup.tar.gz')
    writeFileSync(backup, 'x')
    const result = runScript('switch-to-official.sh', [backup])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Nothing was changed')
    expect(calls()).toContain('enable --now')
    expect(existsSync(join(home, '.config', 'orca', 'orcad.lock'))).toBe(true)
  })

  it('checks the official image and the backup before anything else', () => {
    rmSync(join(base, 'Official.AppImage'))
    expect(runScript('switch-to-official.sh').stderr).toContain('No official AppImage')
    expect(calls()).toBe('')
  })
})

describe('script syntax', () => {
  it.each(['switch-to-fork.sh', 'switch-to-official.sh', 'profile-lock.sh', 'rebase-upstream.sh'])(
    '%s parses',
    (name) => {
      expect(spawnSync('bash', ['-n', join(SOURCE, name)]).status).toBe(0)
    }
  )
})
