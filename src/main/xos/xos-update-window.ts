// XOS fork: a small progress window for Help → Check for Updates. It follows the build log
// (xos/build.sh output) for known milestones, estimates the rest from the last build's duration,
// mirrors progress on the taskbar icon, and becomes the install prompt when the build finishes.
// No preload: main pushes state with executeJavaScript and buttons navigate to xos-update://<action>.
import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { BrowserWindow, shell } from 'electron'

export type UpdateWindowAction = 'install' | 'later' | 'hide' | 'log'

/** Log line patterns in build order, with the share of the build done once each appears. */
export const MILESTONES: { pattern: RegExp; percent: number; phase: string }[] = [
  { pattern: /^Building Orca /, percent: 2, phase: 'Installing dependencies' },
  { pattern: /pnpm run build:wsl-guest/, percent: 6, phase: 'Building helpers and CLI' },
  { pattern: /building ssr environment/, percent: 15, phase: 'Compiling the main process' },
  { pattern: /building client environment/, percent: 30, phase: 'Compiling the interface' },
  { pattern: /\[verify-skills-cli-runtime\]/, percent: 62, phase: 'Building the mobile web app' },
  { pattern: /\[build-mobile-web-app-bundle\] OK/, percent: 70, phase: 'Verifying bundles' },
  { pattern: /^\[rebuild\]/, percent: 75, phase: 'Rebuilding native modules' },
  { pattern: /• packaging/, percent: 80, phase: 'Packaging the app' },
  { pattern: /\[verify-packaged-daemon-entry\]/, percent: 86, phase: 'Verifying the package' },
  { pattern: /• building\s+target=AppImage/, percent: 90, phase: 'Writing the AppImage' },
  { pattern: /^Built .* as /, percent: 100, phase: 'Done' }
]

type Status = 'building' | 'ready' | 'failed'

type ViewState = {
  status: Status
  title: string
  phase: string
  percent: number
  detail: string
  elapsed: string
  remaining: string
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Orca XOS update</title>
<style>
:root{color-scheme:light dark;--fg:#1c1c1e;--muted:#6b6b70;--bg:#f6f6f7;--track:#e2e2e5;--bar:#2563eb;--bad:#dc2626;--ok:#059669;--on-bar:#fff}
@media (prefers-color-scheme:dark){:root{--fg:#ececee;--muted:#9a9aa0;--bg:#18181b;--track:#2c2c31;--bar:#60a5fa;--bad:#f87171;--ok:#34d399;--on-bar:#0b1220}}
*{box-sizing:border-box}body{margin:0;padding:18px 20px;font:13px/1.45 system-ui,sans-serif;background:var(--bg);color:var(--fg);user-select:none}
h1{font-size:15px;margin:0 0 4px}#phase{color:var(--muted);margin:0 0 12px;min-height:19px}
.track{height:8px;border-radius:4px;background:var(--track);overflow:hidden}
#bar{height:100%;width:0;background:var(--bar);transition:width .6s ease}
.failed #bar{background:var(--bad)}.ready #bar{background:var(--ok)}
.row{display:flex;justify-content:space-between;color:var(--muted);font-size:12px;margin-top:6px}
#detail{margin-top:10px;font:11px/1.4 ui-monospace,monospace;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-height:16px}
.buttons{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}
a{padding:6px 12px;border-radius:6px;border:1px solid var(--track);color:var(--fg);text-decoration:none}
a.primary{background:var(--bar);border-color:var(--bar);color:var(--on-bar)}a[hidden]{display:none}
</style></head><body>
<h1 id="title">Building Orca XOS…</h1><p id="phase"></p>
<div class="track"><div id="bar"></div></div>
<div class="row"><span id="pct"></span><span id="time"></span></div>
<div id="detail"></div>
<div class="buttons">
<a href="xos-update://log" id="log">Open log</a>
<a href="xos-update://hide" id="hide">Hide</a>
<a href="xos-update://later" id="later" hidden>Later</a>
<a href="xos-update://install" id="install" class="primary" hidden>Restart and install</a>
</div>
<script>
function update(s){
  document.body.className=s.status;
  document.getElementById('title').textContent=s.title;
  document.getElementById('phase').textContent=s.phase;
  document.getElementById('bar').style.width=s.percent+'%';
  document.getElementById('pct').textContent=s.percent+'%';
  document.getElementById('time').textContent=s.elapsed+(s.remaining?' · '+s.remaining:'');
  document.getElementById('detail').textContent=s.detail;
  document.getElementById('hide').hidden=s.status!=='building';
  document.getElementById('later').hidden=s.status==='building';
  document.getElementById('later').textContent=s.status==='failed'?'Close':'Later';
  document.getElementById('install').hidden=s.status!=='ready';
}
</script></body></html>`

function clock(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function stripAnsi(text: string): string {
  // oxlint-disable-next-line no-control-regex -- build output carries ANSI colour codes
  return text.replace(/\u001b\[[0-9;]*m/g, '')
}

/** Follows one build: call start(), then finish(); the window can be hidden and re-shown. */
export class XosUpdateWindow {
  private window: BrowserWindow | null = null
  private timer: NodeJS.Timeout | null = null
  private offset = 0
  private partial = ''
  private milestone = 0
  private lastLine = ''
  private startedAt = Date.now()
  private finishedAt: number | null = null
  private status: Status = 'building'
  private title = ''

  constructor(
    private readonly sha: string,
    private readonly logPath: string,
    /** Duration of the last successful build, for the time estimate. */
    private readonly expectedMs: number | null,
    private readonly onAction: (action: UpdateWindowAction) => void
  ) {}

  start(): void {
    this.startedAt = Date.now()
    this.title = `Building Orca XOS ${this.sha}…`
    this.show()
    this.timer = setInterval(() => this.tick(), 1000)
  }

  show(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.show()
      this.window.focus()
      return
    }
    const win = new BrowserWindow({
      width: 480,
      height: 270,
      resizable: false,
      minimizable: true,
      maximizable: false,
      fullscreenable: false,
      autoHideMenuBar: true,
      title: 'Orca XOS update',
      webPreferences: { sandbox: true, contextIsolation: true, javascript: true }
    })
    win.setMenu(null)
    win.webContents.on('will-navigate', (event, url) => {
      event.preventDefault()
      const action = /^xos-update:\/\/(\w+)/.exec(url)?.[1] as UpdateWindowAction | undefined
      if (action === 'log') {
        void shell.openPath(this.logPath)
      } else if (action === 'hide') {
        win.close()
      } else if (action) {
        this.onAction(action)
      }
    })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('did-finish-load', () => this.render())
    win.on('closed', () => {
      this.window = null
      // Closing a finished build's window means "Later"; while building it only hides.
      if (this.status !== 'building') {
        this.onAction('later')
      }
    })
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`)
    this.window = win
  }

  finish(ok: boolean): void {
    this.readLog()
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.finishedAt = Date.now()
    this.status = ok ? 'ready' : 'failed'
    this.title = ok ? `Build ${this.sha} is ready to install` : 'The XOS build failed'
    if (ok) {
      this.milestone = 100
    }
    this.show()
    this.render()
  }

  close(): void {
    if (this.timer) {
      clearInterval(this.timer)
    }
    setTaskbarProgress(-1)
    if (this.window && !this.window.isDestroyed()) {
      this.window.close()
    }
  }

  private tick(): void {
    this.readLog()
    this.render()
  }

  /** Reads only the bytes appended since the last tick. */
  private readLog(): void {
    let fd: number | null = null
    try {
      const size = statSync(this.logPath).size
      if (size <= this.offset) {
        return
      }
      fd = openSync(this.logPath, 'r')
      const buffer = Buffer.alloc(size - this.offset)
      readSync(fd, buffer, 0, buffer.length, this.offset)
      this.offset = size
      const lines = (this.partial + buffer.toString('utf8')).split('\n')
      this.partial = lines.pop() ?? ''
      for (const raw of lines) {
        const line = stripAnsi(raw).trim()
        if (!line) {
          continue
        }
        this.lastLine = line
        for (const milestone of MILESTONES) {
          if (milestone.percent > this.milestone && milestone.pattern.test(line)) {
            this.milestone = milestone.percent
          }
        }
      }
    } catch {
      // The log appears a moment after the build starts.
    } finally {
      if (fd !== null) {
        closeSync(fd)
      }
    }
  }

  private percent(elapsed: number): number {
    if (this.status !== 'building') {
      return this.status === 'ready' ? 100 : this.milestone
    }
    // Between milestones, creep toward the next one by time, never past it.
    const next = MILESTONES.find((milestone) => milestone.percent > this.milestone)?.percent ?? 99
    const byTime = this.expectedMs ? Math.round((elapsed / this.expectedMs) * 100) : 0
    return Math.min(Math.max(this.milestone, byTime), next - 1, 99)
  }

  private render(): void {
    const elapsed = (this.finishedAt ?? Date.now()) - this.startedAt
    const percent = this.percent(elapsed)
    const phase =
      this.status === 'failed'
        ? 'Open the log to see what went wrong.'
        : ([...MILESTONES].toReversed().find((milestone) => milestone.percent <= this.milestone)
            ?.phase ?? 'Starting')
    const remaining =
      this.status === 'building' && this.expectedMs
        ? elapsed < this.expectedMs
          ? `about ${clock(this.expectedMs - elapsed)} left`
          : 'taking longer than last time'
        : ''
    const state: ViewState = {
      status: this.status,
      title: this.title,
      phase:
        this.status === 'ready'
          ? `Built in ${clock(elapsed)}. Installing closes Orca, backs up your profile and reopens it; agent terminals keep running.`
          : phase,
      percent,
      detail: this.status === 'ready' ? '' : this.lastLine.slice(0, 300),
      elapsed: `${clock(elapsed)} elapsed`,
      remaining
    }
    setTaskbarProgress(this.status === 'building' ? percent / 100 : -1)
    if (this.window && !this.window.isDestroyed() && !this.window.webContents.isLoading()) {
      void this.window.webContents
        .executeJavaScript(`update(${JSON.stringify(state)})`)
        .catch(() => {})
    }
  }
}

function setTaskbarProgress(value: number): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.setProgressBar(value)
    }
  }
}
