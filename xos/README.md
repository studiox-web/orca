# XOS fork tooling

Studio X builds of Orca from the `xos` branch. `upstream` = stablyai/orca, `origin` = studiox-web/orca.

| Script                                      | What it does                                                                                                                           |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `xos/build.sh`                              | Builds `dist/orca-linux.AppImage`, stamped `<latest upstream release>+xos.<commit>`                                                    |
| `xos/switch-to-fork.sh`                     | With Orca closed: backs up `~/.config/orca`, installs `~/Applications/Orca-XOS.AppImage`, adds an "Orca (XOS)" menu entry, launches it |
| `xos/switch-to-official.sh [backup.tar.gz]` | With Orca closed: launches `~/Downloads/Orca.AppImage`, optionally restoring a profile backup first                                    |

Update cycle: `git fetch upstream && git rebase upstream/main`, then `xos/build.sh`, quit Orca, `xos/switch-to-fork.sh`.

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
- Pause/resume comments a crontab line out as `#orca-xos-paused# <line>`. Every write backs up the crontab to
  `~/.orca-xos/crontab-backups/`, is refused if the crontab changed since the board loaded, and is logged to
  `~/.orca-xos/audit.jsonl`.
- Run now opens a terminal in the project running the same command cron would (goal runs keep their locks and
  receipts); projects not added to Orca run detached with output in `~/.orca-xos/runs/`.
