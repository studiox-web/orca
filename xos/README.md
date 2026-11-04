# XOS fork tooling

Studio X builds of Orca from the `xos` branch. `upstream` = stablyai/orca, `origin` = studiox-web/orca.

| Script                                      | What it does                                                                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `xos/build.sh`                              | Builds `dist/orca-linux.AppImage`, stamped `<latest upstream release>+xos.<commit>`                                                      |
| `xos/switch-to-fork.sh`                     | With Orca closed: backs up `~/.config/orca`, installs `~/Applications/Orca-XOS.AppImage`, adds an "Orca (XOS)" menu entry, launches it   |
| `xos/rebase-upstream.sh [--dry-run]`        | Rebases `xos` onto the latest upstream release tag, then runs the XOS checks                                                             |
| `xos/switch-to-official.sh [backup.tar.gz]` | With Orca closed: stops and disables `orca-xos-serve`, launches `~/Downloads/Orca.AppImage`, optionally restoring a profile backup first |

Update cycle: `xos/rebase-upstream.sh` (onto the latest upstream release tag, with rerere; `--dry-run` to preview), then `xos/build.sh`, quit Orca, `xos/switch-to-fork.sh`.

Fork builds never check upstream releases (`src/main/updater/updater-fork-guard.ts`); set
`ORCA_FORK_ALLOW_RELEASE_UPDATES=1` to restore them.

## Always-on scheduling (orcad boot service)

`xos/orcad/install.sh` installs a systemd user service, `orca-xos-serve`, that runs this fork headless
(`orca-ide serve --supervise`) from an extracted copy of `~/Applications/Orca-XOS.AppImage`, with linger on.
The desktop app and the headless runtime share one profile lock: while the app is open the service waits;
within a minute of quitting the app it takes over the scheduler. The "Orca (XOS)" menu entry runs
`orca-xos-desktop.sh`, which stops the service, opens the app, and restarts the service once the app holds
the profile. Logs: `journalctl --user -u orca-xos-serve`.

## Automations → Org chart (stage 0)

The default Automations view is a goal board over the existing `automations/goals/*` folders, run receipts
(`automations/logs/*.jsonl`, tail only) and the crontab, for every Orca project (or crontab working directory)
with an `automations/goals` folder. Code: `src/main/xos/` and `src/renderer/src/components/xos-goals/`.

- Areas and reporting lines: `~/.orca-xos/projects/<checkout-folder>/org.json` (e.g. `djvibe-com`), then
  GOAL.md `area:`, then the Cascade defaults.
- Card art: the project's `public/images/admin/ops-cards/`, then the shared deck in `~/.orca-xos/deck/ops-cards/`.
- Pause/resume comments a crontab line out as `#orca-xos-paused# <line>`. Lines Orca doesn't manage need adopting first, and lines paused by hand with `# PAUSED FOR ORCA MIGRATION <date>:` show as paused but only a resume of that one line restores them. Every write backs up the crontab to
  `~/.orca-xos/crontab-backups/`, is refused if the crontab changed since the board loaded, and is logged to
  `~/.orca-xos/audit.jsonl`.
- Run now opens a terminal in the project running the same command cron would (goal runs keep their locks and
  receipts) until the goal moves to the central home, then runs natively; projects not added to Orca run detached with
  output in `~/.orca-xos/runs/`.

## Automation runtime (stage A)

On an automation's detail page, **Models, fallbacks and limits** holds the fork's per-automation runtime
settings (stored in `~/.orca-xos/automation-runtime.json`; each run's model, reason, outcome and commit go
to `~/.orca-xos/automation-runs.jsonl`). The editor gets Model and Effort pickers.

- Fallback chain: a terminal run that ends on a usage limit, overload, sign-in problem or missing agent is
  retried on the next model. Scheduled runs always; manual runs when "Also on manual runs" is on.
- Auto: picks the tier's model with the most quota left before reset; the tier map is editable there.
- Lock lane / wait / timeout: same flock files as `run-goal-cron.sh`, so Orca and crontab runs never overlap.
- Commit after each run: only the listed owned paths, under the shared `git-commit.lock`, optional push.

## Goal entity & centralized project home (stage B)

- `orca goals import [<repo>] [--goal a,b] [--force] [--json]` initializes `~/.orca-xos/projects/<slug>/` (own Git repo
  with `goals/`, `shared/`, `AGENTS.md`, `items/<type>/<stage>/`, `org.json`, `project.json`) and imports goals and work
  items, then auto-commits. `--goal` cuts over only those goals; goals already in the home are kept unless `--force`. It
  never touches the crontab.
- Each goal resolves on its own: the board, Goal Viewer and Run now use the central copy once a goal is imported, and the
  repo copy until then. A second repo with the same folder name gets its own hashed home.
- Native prompt assembly (`AGENTS.md` + `GOAL.md` with `@shared/...` includes + `SOUL.md`/`LESSONS.md`/`DECISIONS.md` +
  `STATUS.md` + `MEMORY.md` + open `inbox/*.md` within a size budget + latest log + queue snapshot + operator message).
  Messages are marked read only once the run has really launched.
- Run modes in Goal Viewer: normal run, `Reply inbox` (the agent's cheap model, `low`, `dm` lane, no fallback, no auto-commit),
  sidecar run (`sidecars/<name>.md`), operator run-with-message, and `Definition of Done met` stop/reopen handling.
- Declared `queues:` frontmatter in `GOAL.md`, pre-run queue gate (`skipped_precheck` on daily cap, empty input queue,
  or downstream ceiling/hard cap), item claiming (`claimed_by`/`claimed_at` with stale-claim expiry), and transition
  index (`transitions.jsonl`).
- Stage A carryover fixes: a nested run started through the CLI shares its parent's lane while the parent really holds
  it (`CASCADE_ACTIVE_LOCK_LANE`, forwarded by the CLI), and chat-surface automation runs forward model/effort overrides
  and classify structured failure facts for fallback.

## Running goals and replacing cron

Nothing here turns itself on. See `xos/PLAN.md` §4c.

| Command                                                                  | What it does                                                     |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `orca goals migrate plan`                                                | Every crontab job, its replacement, and whether it runs anywhere |
| `orca goals migrate replace --job <id>`                                  | Creates the replacement automation, disabled                     |
| `orca goals schedule <goal> --schedule "<cron>"`                         | Creates a goal's automation, disabled                            |
| `orca goals authorize <goal> --confirm <goal>`                           | Lets a goal bypass the sandbox and run with its authority        |
| `orca goals triggers --enable --project <p>`                             | Queue and inbox events start runs for this project               |
| `orca goals run\|reply\|stop\|runs\|release\|status\|briefing\|messages` | Runs and reads; run and stop need Orca open, the rest don't      |
| `orca goals notify`, `orca goals notifications`                          | Outbound queue for the operator bot                              |
| `orca goals github-sync [--close]`                                       | Issues into local items; `--close` closes completed ones         |
| `orca usage limits`                                                      | Live quota per agent, as Auto mode sees it                       |

Status and remaining work: `xos/PLAN.md` §4a–4c and `xos/audit-ledger-5716fed3b9.md`.
