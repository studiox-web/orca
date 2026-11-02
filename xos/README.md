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
