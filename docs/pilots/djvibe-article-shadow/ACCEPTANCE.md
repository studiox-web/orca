# Native article pilot acceptance path

Status: the isolated four-worker native smoke and held-gate restart passed,
and independent source review cleared the three original blockers. Installed-app
activation and paired workflow evaluation remain separate work. See the final
observed results below for exact coverage and limits.

## Input and comparison

`inputs-v1/input-manifest.json` pins every worker input. `fixture/` contains
deliberately invented primary declarations, brief, media limits and a one-entry
synthetic archive. There is no claim to current news, current ready backlog or
live duplicate coverage. Both the title and first body line of a produced draft
must say `SYNTHETIC TEST CONTENT - NOT NEWS`.

Copy the same input bytes into two fresh ordinary isolated folders. Retain the
same input-manifest digest and explicit per-stage provider/model/effort choices.
Use one Codex-only override in both arms only after the coordinator pins it;
the original Goal files and their original model frontmatter stay unchanged.
The override is preparation for this smoke, not evidence of equivalence to the
original Claude/Codex mix or the production wrapper.

Arm A runs the four children through one native parent. Arm B is a manual serial
prompt-repackaging baseline using the same scoped Goal references and fixture,
with the same distinct writer/editor, limits and isolated tools. Arm B does not
run the operational wrapper. Record its exact stage order and handoffs before
execution; the proposed initial order is brief-review, media-context, writer,
editor. This compares orchestration against manual handoff, not historical
production throughput. A later tuned-model/real-story comparison is separate.

Use `paired-evaluation.template.json`; null usage/cost/timing is unmeasured, not
zero. Evaluate fixture-fact accuracy, unsupported claims, exact credits, synthetic
labelling, voice/compression, fixture-only duplication, review findings, revisions,
interventions, elapsed time and audit completeness. Do not award factual-news or
public-media readiness from this synthetic smoke. No benchmark result exists yet.

## Native payload preparation

The preparation functions are in
`tests/e2e/coordinated-automation-harness/coordinated-article-pilot-package.ts`.
They perform reads and schema validation only, with no runtime, provider or
profile writes:

```ts
const inputs = loadArticlePilotInputs(inputRoot)
const selection = {
  workspaceId: exactRegisteredFolderWorkspaceKey,
  promptAuthority: exactIsolatedInputAuthority,
  maxEstimatedCostUsd: coordinatorChosenPositiveEstimatedCeiling,
  models: {
    'brief-review': { model: pinnedBriefModel, reasoningEffort: pinnedBriefEffort },
    'media-context': { model: pinnedMediaModel, reasoningEffort: pinnedMediaEffort },
    'write-draft': { model: pinnedWriterModel, reasoningEffort: pinnedWriterEffort },
    'editor-review': { model: pinnedEditorModel, reasoningEffort: pinnedEditorEffort }
  }
}
const createParams = buildArticlePilotCreateRequest(inputs, selection, retainedCreationKey)
```

Every variable above must come from the coordinator's exact isolated host setup;
none is an inferred live profile, model fallback or production path. The generated
`automation.createCoordinated` parameters include `kind: 'coordinated'`,
`triggerPolicy: 'manual_only'`, `enabled: false`, destination Self, an existing
folder workspace, skipped setup and four editable children. They omit `rrule`,
`dtstart` and client-controlled `definitionRevision`. The native host assigns the
revision; no live profile file is seeded. Legacy storage's empty recurrence and
zero timestamps are inert compatibility fields, not a recurrence to enable.

Place the complete package under `workspace/inputs/`. Child prompts are pinned
source references at `inputs/prompts/<child-id>.md`, resolved beneath that exact
input root with the common host-bound authority. Each composed prompt includes
the unchanged original Goal bytes, framed by the separately versioned pilot
scope. The host must also provide a positive finite per-attempt estimate callback;
the selected estimate ceiling limits estimated accounting, not measured billing.

The trusted developer entry composes the actual source API below. The opaque
`sandboxPolicy` must come from the enforcing host after its controls are proven;
it is not JSON, a flag, or a value the package can synthesize. This is an API
setup recipe, not an executed launch command:

```ts
createIsolatedNativeCoordinatedAppComposition({
  userDataDirectory,
  pilotScope: {
    homeDirectory,
    workspaceId: selection.workspaceId,
    workspacePath,
    inputRoot,
    promptAuthority: selection.promptAuthority,
    idempotencyKey: retainedManualRunKey,
    sandboxPolicy
  },
  laneLocks,
  estimateCostUsd
})
```

Its implementation lives in
`src/main/startup/main-process-native-pilot-composition.ts`. It admits a matching
local developer profile only; packaged, headless, default and unproven hosts stay
unavailable. There is no normal CLI flag that safely turns this package on.

The wire schema and native receipt changes are owned by the runtime worker.
The pilot graph permits only `ready_for_review` as a successful outcome; it does
not silently widen to `completed`, `ready_to_publish` or `published_verified`.
The native terminal reports still have technical `outcome: succeeded`; that alone
does not satisfy stage or parent acceptance.

After capability, isolation, identity, model and budget checks pass, the
coordinator may use these exact RPC envelopes through the supported runtime
transport. The package worker did not send them:

```ts
{ method: 'automation.createCoordinated', params: createParams }
{ method: 'automation.startCoordinatedNativeRun', params: {
  runtimeId, automationId, expectedOwner: { selector: { kind: 'self' } },
  expectedDefinitionRevision, idempotencyKey: retainedManualRunKey
} }
{ method: 'automation.inspectCoordinatedRun', params: {
  runtimeId, automationId, automationRunId,
  expectedOwner: { selector: { kind: 'self' } }
} }
{ method: 'automation.reconcileCoordinatedNativeRun', params: {
  runtimeId, automationId, automationRunId,
  expectedOwner: { selector: { kind: 'self' } }
} }
```

Inspect/read back after creation. Retain creation and manual-run keys before
sending. An uncertain response requires inspecting the exact existing record and
receipt before reusing the same key; never substitute a new key to “try again”.
An unavailable native capability is a blocker, never a reason to use the fake-run
API or a single-prompt automation. Fake APIs appear only inside unit fixtures.

## Artifact acceptance and reports

Expected output paths are `outputs/brief-review.json`,
`outputs/media-context-review.json`, `outputs/draft.md`,
`outputs/editor-review.json`, and immutable writer revisions under
`outputs/revisions/<writer-dispatch-id>.md`. The writer must report a required
`draft-revision` artifact at that exact attempt path, with the same digest as
`draft`. The native validator substitutes `{dispatchId}` from the current attempt
and enforces `sameDigestAs: draft` before the editor can start. Both files must
exist and match their actual bytes. Accepted artifact revalidation blocks final
completion if either later changes or disappears; the read-only human preview
also requires the exact writer revision. Empty precreated files are not evidence.
Host exports additionally retain the frozen input manifest,
source packet, definition snapshot, native report envelopes, revision/attempt
history, plus any available completion receipt and measured usage. The physical
smoke deliberately has no final receipt and does not measure billing. Export receipts are not authored
by the worker and must not be fabricated before a run succeeds.

Each attempt copies the host-issued coordinated report contract exactly. Brief,
media, writer and editor checks belong to their respective native stages. The
editor's `draft-digest` check must contain the exact `sha256:...` value as an
evidence entry. Its `reviewed-draft` artifact has that digest and URI
`outputs/draft.md`; its separate review JSON binds both distinct Task/Dispatch
pairs. It never claims to be the producer of the writer's attempt.

The editor stage holds `pilot-artifact-review`. The coordinator uses
`prepareArticlePilotApproval({ selection, view, workspacePath })` from
`coordinated-article-pilot-acceptance.ts` to prepare a native gate payload after
inspecting the exact host view and files. This read-only function refuses changed
runtime/run/config authority, missing independent evidence, mismatched digests,
wrong attempt identities, findings, non-approval or absent synthetic labelling.
It also rejects duplicate check IDs and checks attributed to a different stage,
so an earlier report cannot supply the final editor's digest evidence.
It does not dispatch approval or mint a completion receipt. Keep the displayed
candidate through an uncertain response; re-inspect before deciding again.

Send the reviewed result as `automation.resolveCoordinatedGate` parameters only
when the coordinator has performed the independent check. The native gate binds
the held Dispatch and report digest and revalidates artifact bytes. Then inspect
the host receipt, verify `finalState: ready_for_review`, the frozen digest,
Task/Dispatch mapping and `draft-digest` acceptance evidence. Any missing evidence
keeps preparation or blocked status. The gate is not a substitute for isolation.

## Coordinator-only physical and hidden UI checks

Use the current rebuilt isolated developer composition, `ORCA_BACKGROUND_LAUNCH=1`
and hidden Playwright/CDP. Do not launch the installed everyday profile, reveal a
window or activate the desktop. Record exact build/blob hashes, runtime/profile/
workspace identity, containment proof, selected model/effort and both viewports:
1280 x 900 desktop and 390 x 844 mobile-width renderer. The manual native test records these viewports; retain its exit status and
artifacts before claiming acceptance.

1. Open the manual parent and its four configured children. Verify role, prompt,
   model and inherited/overridden controls; an edit applies only to the next run.
2. Start exactly one native manual run and record fresh provider readiness before
   task delivery. While a child is live, inspect its native Task/Dispatch and
   click `Open worker terminal`. The automated smoke covers the first live child;
   each remaining role needs its own navigation check before claiming that coverage.
   The selected handle/pane must match that exact attempt. After settlement, an unavailable session is honest; never invent one.
3. Inspect native readable reports and artifact URIs/digests. Open the actual
   artifact through the app's supported file navigation and compare its contents
   and digest to the accepted report. A URI printed as text is not proof of a
   clickable artifact link. If the surface lacks that navigation, report the gap.
4. Hold the editor approval and verify its report/draft digest on screen. Run the
   read-only acceptance preview. The automated physical smoke does
   not submit human approval. It then reopens the same retained profile and checks
   the descriptor, parent run, all Task/Dispatch IDs and held report digest. After separate human review, resolve the exact gate
   and inspect the native receipt; controlled fixture tests cover that transition. No publisher, schedule, backlog claim or production effect may appear.
5. With a separate sacrificial run in the same containment, exercise readiness
   timeout, duplicate start/report, stale attempt, stop/process-tree liveness and
   restart reconciliation. Inspect the uncertain state before a retry. Do not
   inject fake reports into the physical success run or count a fake run as one.

The native launch/readiness/authenticated-report and session-navigation checks
belong to the coordinator/runtime host. This package's unit tests validate the
same graph using scripted workers, native Store/SQLite/adapter/RPC and actual
temporary artifact bytes. They deliberately assert fake workers have no session
target. No unit result establishes a real provider session or OS isolation.

## Reproduce source-only checks

```sh
PATH=/home/djvibe/.nvm/versions/node/v24.22.2/bin:$PATH ORCA_BACKGROUND_LAUNCH=1 \
  pnpm test tests/e2e/coordinated-automation-harness/coordinated-article-pilot.unit.test.ts \
  tests/e2e/coordinated-automation-harness/coordinated-article-pilot-inputs.unit.test.ts \
  tests/e2e/coordinated-automation-harness/coordinated-article-pilot-recovery.unit.test.ts \
  --maxWorkers=2
```

Do not format the files under `inputs-v1/reference/`: their bytes are pinned and
intentionally preserve the original source formatting. The coordinator owns the
final combined gate, rebuild, app/provider execution and delivery.

## Reproduce the isolated real-provider smoke

This is an explicit opt-in developer test, not a command for the installed everyday
profile. It spends the selected Codex account on a single synthetic four-role run,
uses a disposable profile, preserves exported artifacts in Playwright test results,
and stops before human approval. Use Node 24 and pnpm 12.14.0. Inspect the commands
and provide absolute paths for the installed Codex executable, Node 24 and the
chosen existing account file. Never paste the account file contents.

```sh
export ORCA_BACKGROUND_LAUNCH=1
node config/scripts/build-coordinated-native-report.mjs
VITE_EXPOSE_STORE=true pnpm exec electron-vite build \
  --config tests/e2e/coordinated-automation-harness/electron.native-article.config.ts
node config/scripts/ensure-native-runtime.mjs --runtime=electron
export ORCA_PILOT_CODEX_BINARY=/absolute/path/to/codex
export ORCA_PILOT_NODE_BINARY=/absolute/path/to/node24
export ORCA_PILOT_AUTH_FILE=/absolute/path/to/selected/account/auth.json
ORCA_RUN_NATIVE_ARTICLE_PILOT=1 pnpm exec playwright test \
  --config tests/e2e/coordinated-automation-harness/playwright.native-article.config.ts \
  --workers=1
```

Do not run `pnpm test` concurrently: its native dependency preparation switches to
the Node ABI. The full real run is distinct from the cheaper controlled fixtures.
A content-approved report can still fail host artifact/identity validation; keep
that failure as evidence and never rewrite the worker's result to manufacture
acceptance. Artifact `producerAttempt` is an optional current-producer assertion,
so the editor omits it for its upstream draft reference and records both original
identities in its review JSON. Required artifact kinds and paths are supplied from
the frozen stage configuration. Synthetic labels must appear in the title and
first body line after any frontmatter; labels only in metadata do not qualify.

## Review corrections and retained-profile behavior

The independent source review returned three blockers: revoked write authority was
not rechecked by the report endpoint, the test entry could not reopen an existing
profile, and the writer revision was optional evidence. All three have source
corrections with focused regression coverage. The independent follow-up cleared all three source blockers; the final
physical/restart smoke also passed. The final repository gate remains a delivery
condition.

Startup now validates the saved profile/repository/workspace, input authority and
manual idempotency key. It awaits the real profile store's durable flush before
publishing a new descriptor. On reopening it reuses that descriptor unchanged and
preserves every lane-lock file and its owner. A missing descriptor beside a known
workspace, mismatched identity or malformed descriptor refuses startup for manual
reconciliation. Reopening never removes a retained lock or proves its owner dead.
The restart smoke covers a settled human-review hold, not recovery of a crashed
live provider or a forced lock reclamation.

The first desktop screenshot showed the held report clearly. Its narrow-width
capture retained the expanded desktop sidebar and was unreadable; it is not mobile
usability evidence. The revised narrow-width smoke explicitly collapses that
sidebar and requires the report width to be at least 280 px at a 390×844 viewport.
This remains a desktop renderer viewport check, not mobile-device acceptance.

The corrected collapsed-sidebar capture had a readable 280 px report column;
long parent titles still overlap the header control at this narrow desktop width.
That layout limitation remains deferred and is not represented as mobile readiness.

## Final observed smoke and review

The hidden native test passed with exit 0 in about 4.3 minutes on run
`44688502-8f80-431e-b4ca-9fe8ff4af1cb`. Four real Codex workers completed their
native reports and automatic parent progression held the independent editor for
human review. Reopening the same profile preserved descriptor bytes, the parent
run, all four Task/Dispatch pairs and held report digest. The test asserted every
app window remained hidden. First-worker navigation opened the exact active Task
terminal; the saved screenshot contains live worker output.

Root verified every exported artifact digest, including identical current draft
and writer revision bytes. The read-only approval preview exists; no approval was
submitted, and the native semantic completion receipt remains absent. Evidence is
under `test-results/coordinated-native-article-3c9e0-the-independent-review-gate-electron-headless/`,
with a retained local copy at `.cache/article-pilot-final-pass/` containing the
result, restart inspection, screenshots, artifacts, descriptor and cleanup record.
No process remained associated with the exact test profile before its removal.

Independent follow-up `task_d55f085fa404` / `ctx_fc1ed8a714c7` cleared all three
source blockers after checking the 145-file manifest and all 26 changed paths.
Recorded source checks passed: 84 tests in 12 affected suites; 17 in three
persistence/composition suites (counts overlap); Node/CLI/web and harness
typechecks; changed-code quality with zero findings across 110 source files.
The final `check:changed` gate is still required after documentation updates.
Paired baseline, measured cost, crashed-live-provider recovery, physical final
approval, packaged activation and live migration are not claimed by this result.
