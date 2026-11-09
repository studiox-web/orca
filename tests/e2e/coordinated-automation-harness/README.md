# Coordinated Automation deterministic test harness

This test-only harness exercises coordinated Automation recovery and admission scenarios without
starting Orca, Electron, an agent provider, a system timer, or an external effect. It is deliberately
located under `tests/e2e` and is discovered only through the `*.unit.test.ts` lane.

## Isolation boundary

`CoordinatedAutomationTestHarness.create()` is the only factory. It always creates a new child of the
operating system temporary directory and does not accept a profile, repository, Automation database,
or orchestration database path. The harness exposes only:

- `FakeClockScheduler`, whose queue advances explicitly and never calls a system timer;
- temporary JSON Automation and orchestration stores below the harness root;
- `TemporaryArtifactStore`, which accepts only contract-valid relative or `artifact://` URIs and can
  tamper, age, or remove evidence deterministically;
- `ScriptedFakeWorkerProvider`, which accepts a finite action DSL and has no real-provider fallback;
- `FakeEffectAdapter`, whose five states are persisted only in the temporary root; and
- `HarnessCrashInjector` plus an exact, ordered event trace.

The blocked capability list covers real providers, external effects, live Automation and orchestration
stores, publishers, system schedules, backups, and DJVibe production. Harness TypeScript has a
self-test that rejects main-process imports, process spawning, network calls, and system timers.

## Crash and restart scenarios

`HARNESS_CRASH_POINTS` names every durable-write boundary and every acknowledgement boundary exposed
by the harness. Arm one point before the action:

```ts
harness.crashes.arm('worker-provider.before-acknowledgement')
await expect(harness.workers.run(identity)).rejects.toThrow(InjectedHarnessCrash)
```

`harness.reopen()` constructs fresh adapters over the same temporary evidence while retaining the fake
clock and trace. This models coordinator replacement without touching a live profile. A crash point is
one-shot, so replay can assert idempotency and convergence.

## Event assertions

Every event contains a monotonically increasing sequence, fake timestamp, exact identity fields, type,
and structured detail. Use `harness.trace.snapshot()` for ordinary assertions or
`harness.trace.assertExact(expected)` when event order is the contract. Scheduled work is run with
`advanceTo`, `advanceBy`, or `runUntilIdle`; tests never need sleeps.

## Focused check

Use the repository's required Node and worker limit:

```sh
PATH=/home/djvibe/.nvm/versions/node/v24.22.2/bin:$PATH \
  ORCA_BACKGROUND_LAUNCH=1 \
  pnpm test tests/e2e/coordinated-automation-harness/coordinated-automation-test-harness.unit.test.ts \
  --maxWorkers=2
```
