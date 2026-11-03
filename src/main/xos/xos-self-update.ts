// XOS fork: Help → Check for Updates builds and installs the fork from the local `xos` checkout,
// so updating needs no shell. Build runs xos/build.sh in the background; install quits Orca and a
// detached helper runs xos/switch-to-fork.sh once every Orca window process has exited.
import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, dialog, Notification } from 'electron'
import { xosHome } from './xos-crontab'

type BuildState = { sha: string; builtAt: string }

let busy = false

function repoDir(): string {
  return process.env.ORCA_XOS_REPO ?? join(homedir(), 'projects', 'orca-fork')
}

function stateDir(): string {
  const dir = join(xosHome(), 'update')
  mkdirSync(dir, { recursive: true })
  return dir
}

function git(args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', ['-C', repoDir(), ...args], { timeout: 15_000 }, (error, stdout) =>
      resolve(error ? null : String(stdout).trim())
    )
  })
}

/** The commit this build was made from, from the `<release>+xos.<sha>` version stamp. */
function runningSha(): string | null {
  return /\+xos\.([0-9a-f]+)/.exec(app.getVersion())?.[1] ?? null
}

function readBuildState(): BuildState | null {
  try {
    return JSON.parse(readFileSync(join(stateDir(), 'last-build.json'), 'utf8')) as BuildState
  } catch {
    return null
  }
}

function notify(body: string): void {
  if (Notification.isSupported()) {
    new Notification({ title: 'Orca XOS update', body }).show()
  }
}

async function ask(message: string, detail: string, buttons: string[]): Promise<number> {
  const result = await dialog.showMessageBox({
    type: 'info',
    title: 'Orca XOS update',
    message,
    detail,
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1
  })
  return result.response
}

function runBuild(sha: string): Promise<{ ok: boolean; logPath: string }> {
  const logPath = join(stateDir(), `build-${new Date().toISOString().replace(/[:.]/g, '-')}.log`)
  const fd = openSync(logPath, 'a')
  return new Promise((resolve) => {
    const child = spawn('/bin/bash', [join(repoDir(), 'xos', 'build.sh')], {
      cwd: repoDir(),
      stdio: ['ignore', fd, fd]
    })
    child.on('close', (code) => {
      closeSync(fd)
      if (code === 0) {
        const state: BuildState = { sha, builtAt: new Date().toISOString() }
        writeFileSync(join(stateDir(), 'last-build.json'), JSON.stringify(state))
      }
      resolve({ ok: code === 0, logPath })
    })
    child.on('error', () => resolve({ ok: false, logPath }))
  })
}

/** Quit, then let a detached helper wait for Orca to exit and run switch-to-fork.sh. */
function installAndRestart(): void {
  const logPath = join(stateDir(), 'install.log')
  const script = join(repoDir(), 'xos', 'switch-to-fork.sh')
  // Same "is Orca still running" test switch-to-fork.sh uses; give up after 30 minutes.
  const helper = `
for i in $(seq 1 1800); do
  pgrep -af '(\\.mount_[^/ ]*/orca-ide|Orca-XOS\\.AppImage|Orca\\.AppImage)' | grep -v -- ' -e ' >/dev/null || break
  sleep 1
done
sleep 1
exec "$1"
`
  const fd = openSync(logPath, 'a')
  const child = spawn('/bin/bash', ['-c', helper, 'xos-install', script], {
    detached: true,
    stdio: ['ignore', fd, fd]
  })
  child.unref()
  closeSync(fd)
  app.quit()
}

async function offerInstall(sha: string): Promise<void> {
  const choice = await ask(
    `Build ${sha} is ready to install.`,
    'Orca will close, back up your profile, install the new build, and reopen. Running agent terminals keep running.',
    ['Restart and install', 'Later']
  )
  if (choice === 0) {
    installAndRestart()
  }
}

async function checkAndUpdate(): Promise<void> {
  const repo = repoDir()
  if (!existsSync(join(repo, 'xos', 'build.sh'))) {
    await ask(
      'No XOS checkout found.',
      `Expected the fork at ${repo} (set ORCA_XOS_REPO to change it).`,
      ['OK']
    )
    return
  }
  const branch = await git(['branch', '--show-current'])
  const head = await git(['rev-parse', '--short=10', 'HEAD'])
  if (!head) {
    await ask('Could not read the XOS checkout.', `git failed in ${repo}.`, ['OK'])
    return
  }
  const running = runningSha()
  const built = readBuildState()
  if (running && head.startsWith(running)) {
    const choice = await ask(
      'Orca XOS is up to date.',
      `Running ${running}, the latest commit on ${branch ?? 'the checkout'}.`,
      ['OK', 'Rebuild anyway']
    )
    if (choice !== 1) {
      return
    }
  } else if (built?.sha === head) {
    await offerInstall(head)
    return
  } else {
    const log = running ? await git(['log', '--oneline', '-8', `${running}..HEAD`]) : null
    const dirty = await git(['status', '--porcelain'])
    const choice = await ask(
      `A newer XOS build is available (${head}).`,
      [
        running ? `Running ${running}. New on ${branch}:` : `Branch ${branch}:`,
        log || '(commit list unavailable)',
        branch !== 'xos' ? `\nNote: the checkout is on "${branch}", not "xos".` : '',
        dirty ? '\nNote: the checkout has uncommitted changes; they will be included.' : '',
        '\nBuilding takes a few minutes in the background; you can keep working.'
      ].join('\n'),
      ['Build and install', 'Cancel']
    )
    if (choice !== 0) {
      return
    }
  }
  notify(`Building ${head} in the background…`)
  const result = await runBuild(head)
  if (!result.ok) {
    await ask('The XOS build failed.', `See the log: ${result.logPath}`, ['OK'])
    return
  }
  await offerInstall(head)
}

/** Handles the fork's update menu item; returns false outside packaged Linux fork builds. */
export function startXosSelfUpdate(): boolean {
  if (!app.isPackaged || process.platform !== 'linux' || !runningSha()) {
    return false
  }
  if (busy) {
    notify('An XOS update is already in progress.')
    return true
  }
  busy = true
  void checkAndUpdate().finally(() => {
    busy = false
  })
  return true
}
