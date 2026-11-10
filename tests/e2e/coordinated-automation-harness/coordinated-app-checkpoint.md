# Isolated coordinated desktop checkpoint

The ordinary entry calls `startMainProcess()` without a composition. The separate
`coordinated-app-entry.ts` calls that same bootstrap with typed dependencies after the
active profile Store has been admitted. It uses the runtime-owned orchestration DB and
the existing `state.automations` service, startup recovery, parent lanes and quit hook.

Only the disposable fixture profile enables `experimentalCoordinatedAutomations`.
The fixture requires an unpackaged, hidden local desktop and an isolated HOME under its
user-data directory. The host additionally checks the independent startup-selected active
profile against both the injected root and Store directory on every admission. Missing,
foreign or revoked profile authority refuses. Ordinary settings and composition are unchanged.

Workers use the existing in-process `fake_no_effects` provider. Effects are denied, and
mutation lane acquisition refuses; this app fixture accepts read-only child definitions.
It never calls a real provider, publisher or schedule. Stop, retry, human resolution and
native session destinations remain unavailable. A Task/Dispatch identifier is not a session:
the existing stub-agent `orchestration.workerStart` path creates its own Dispatch, so it
cannot be substituted for a coordinated Dispatch without a reviewed attachment contract.

## Evidence and remaining check

Node tests exercise the actual Store/runtime/service composition and pending-run recovery
before admission. The custom main/preload/renderer bundle compiles to `out-coordinated/`,
separate from ordinary output. These checks do not establish Electron startup or rendered UI.

Electron was **not launched** for this checkpoint: the required `electron` skill was absent
from installed skill roots, and the installed Orca CLI returned `Unknown skill topic "electron"`.
Restore that instruction source before running the prepared hidden lifecycle spec. No
focus or visible-window exception has been requested or applied.

## Next hidden app journey

Use Node 24.22.2 / pnpm 12.14.0 in this checkout after integrating the reviewed source and
restoring the required skill. Build the explicit fixture root, then run only its own config:

```sh
ORCA_BACKGROUND_LAUNCH=1 pnpm exec electron-vite build --mode e2e \
  --config tests/e2e/coordinated-automation-harness/electron.vite.config.ts
ORCA_BACKGROUND_LAUNCH=1 pnpm run ensure:electron-runtime
ORCA_BACKGROUND_LAUNCH=1 pnpm exec playwright test \
  --config tests/e2e/coordinated-automation-harness/playwright.config.ts --workers=1
```

`coordinated-app-lifecycle.spec.ts` owns a temporary profile/HOME through `createRestartSession`,
uses a hidden 1280×900 renderer, and calls the actual local RPC transport. It checks dynamic
fake-run availability, disabled parent creation, a read-only fake run and accepted receipt,
then closes and reopens the same profile and checks exact historical identities/receipt and
idempotent replay. It asserts all Electron windows remain hidden. The custom Playwright
config does not build or launch the ordinary entry and runs one app at a time.

After that passes, the renderer owner can add the create/edit/save/reopen journey against
this same entry and profile fixture, using real DOM actions and assertions plus hidden CDP
screenshots. Native worker navigation remains a separate missing contract; do not mark it
complete from the fake Dispatch alone.

The staged spec can be typechecked without launching Electron:

```sh
pnpm exec tsc --noEmit --composite false --incremental false \
  -p tests/e2e/coordinated-automation-harness/tsconfig.json
```
