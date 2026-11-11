# Isolated coordinated desktop checkpoint

Graham approved the prepared hidden Playwright/CDP method on November 11, 2026 in
place of the unavailable `electron` skill, followed by integration and push to XOS.
This authorization does not enable live execution or install the app.

## Verified combined app journey

The combined XOS source passed both hidden Electron tests (exit 0):

- `coordinated-app-lifecycle.spec.ts`: real local RPC creates a disabled parent,
  completes one no-effect run, restarts the disposable profile, preserves exact
  run/receipt identities, and replays the same request without another run.
- `coordinated-app-renderer.spec.ts`: the actual DOM moves from XOS's organization
  view to the native list, creates a parent and child, edits/saves/reopens it,
  starts a no-effect run, inspects and reconciles the completed receipt, then
  changes the definition while the existing run retains frozen revision 2.
  The updated definition reaches revision 3 and stays disabled. A coordinator
  brief alone is descriptive metadata; the test changes the outcome contract
  to exercise execution revision advancement.

Both assert that Electron windows remain hidden. The renderer uses 1280 by 900,
dark theme; screenshots are saved under the test output directory. This journey
is desktop Linux evidence, not a claim about installed, mobile or cross-OS runtime.

## Isolation and entry selection

The ordinary entry calls `startMainProcess()` without a composition. The separate
`coordinated-app-entry.ts` calls the same bootstrap with typed dependencies after
active-profile Store admission. It uses the existing runtime orchestration DB,
Automation service, startup recovery, parent lanes and quit hook.

The build emits its own package manifest under `out-coordinated/main` with the
repository name/version and fixture main entry. The restart helper explicitly
selects that package root; merely passing a custom main filename to the original
helper selected the ordinary repository package instead. The default launch path
for all other tests is unchanged.

Only the disposable fixture profile enables `experimentalCoordinatedAutomations`.
The fixture requires an unpackaged, hidden local desktop and isolated HOME inside
its temporary user-data directory. Admission checks the independent startup-selected
profile, injected root and Store directory. Missing or foreign authority refuses.

The injected `fake_no_effects` provider accepts read-only child definitions. Effects
are denied and mutation-lane acquisition refuses. No real provider, publisher or
schedule runs. The fake run has no real worker session; unavailable controls remain
unavailable. Native provider/PTY execution and real worker session navigation need
separate physical-runtime acceptance. Ordinary packaged definition writes and
provider execution remain disabled; a normal user build does not activate them.

## Reproduce

Use Node 24 and pnpm 12.14.0. The accepted run used Node 24.22.2. These commands
build only `out-coordinated/`, select Electron-native dependencies, and run one
hidden app at a time with disposable profiles. They do not use an installed profile.

```sh
ORCA_BACKGROUND_LAUNCH=1 pnpm exec electron-vite build --mode e2e \
  --config tests/e2e/coordinated-automation-harness/electron.vite.config.ts
ORCA_BACKGROUND_LAUNCH=1 pnpm run ensure:electron-runtime
ORCA_BACKGROUND_LAUNCH=1 pnpm exec playwright test \
  --config tests/e2e/coordinated-automation-harness/playwright.config.ts --workers=1
```

Typecheck the fixture without launching Electron:

```sh
pnpm exec tsc --noEmit --composite false --incremental false \
  -p tests/e2e/coordinated-automation-harness/tsconfig.json
```
