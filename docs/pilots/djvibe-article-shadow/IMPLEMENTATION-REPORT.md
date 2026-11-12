# Pilot package implementation packet

Worker task `task_3a36d3dd04fd`, dispatch `ctx_cdcd792f4de2`.
Base HEAD verified: `46d5882a0559a83a5edecc612473b6a6b92458b3`.
Work is dirty source only in the assigned pilot docs and new
`coordinated-article-pilot*` harness files. No staging, commit, worktree, install,
deployment, live profile mutation, real provider execution or app launch occurred.
The coordinator and other workers were editing shared source concurrently; the
coordinator owns the final combined gate and exact integrated runtime revision.

## Delivered

- Version 2 [manifest](pilot-manifest.json), [isolation contract](ISOLATION.md),
  [native setup and acceptance path](ACCEPTANCE.md), and unmeasured
  [paired evaluation template](paired-evaluation.template.json).
- Twenty-one frozen inputs: six unchanged Goal files, unchanged SOUL, content
  contract, Jae persona with Lessons, persona routing, writer/editor lessons,
  four synthetic evidence files, a separate scope, and four composed prompts.
  The composed prompts include the exact original Goal bytes and scoped rules;
  the worker cannot silently change the tuned models or prompts.
- A read-only package loader and native schema-validated manual-only payload
  builder, with pinned source references, explicit Codex model/effort selection,
  positive estimated budget, no recurrence and no fake-run fallback.
- A read-only gate preview binding the exact runtime, run/config authority,
  writer/editor Task/Dispatch pairs, both artifact digests, editor decision,
  synthetic labels and stage-owned checks. It returns a native gate request;
  it never sends approval, launches a worker or creates a success receipt.
- Tests using native Store, SQLite, adapter, Runtime/RPC and temporary artifact
  bytes with explicitly scripted fake workers. Fake session targets remain
  unavailable. No fake report was submitted to a live/real-provider run.

Input-manifest digest:
`sha256:feded6b06bfe83caa09b471211c35a021a022c71e5f882c860eb9a71c6f7948f`.
All source paths and Git blob hashes are listed in [source-blobs.json](source-blobs.json).
That inventory excludes itself and this report to avoid recursive hashes; both
are separately identified in the worker completion message.

## Validation evidence

All checks used Node `v24.22.2`, pnpm `12.14.0`, and the explicit Node PATH.
Tests used `ORCA_BACKGROUND_LAUNCH=1` and `--maxWorkers=2`.

| Check                                                                                                                              | Result                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Three focused pilot unit files, command in ACCEPTANCE.md                                                                           | Exit 0; 3 files, 14 tests passed; final run 17:36:09 local, duration 15.16 seconds                                                                                                               |
| `pnpm exec tsc --noEmit --project tests/e2e/coordinated-automation-harness/coordinated-article-pilot.tsconfig.json --pretty false` | Exit 0; focused project including the new harness files and their imported contracts                                                                                                             |
| `pnpm exec oxlint tests/e2e/coordinated-automation-harness/coordinated-article-pilot*.ts`                                          | Exit 0                                                                                                                                                                                           |
| `pnpm exec oxfmt --check` on the six new TypeScript files, pilot tsconfig and five authored package documents/JSON files           | Exit 0; 12 files correct                                                                                                                                                                         |
| `git diff --check -- docs/pilots/djvibe-article-shadow tests/e2e/coordinated-automation-harness/coordinated-article-pilot*.ts`     | Exit 0; tracked diff only, with new-file formatting checked separately                                                                                                                           |
| Read-only source and packet verification                                                                                           | Exit 0; all 12 original source pins match current DJVibe bytes, all 21 frozen inputs match their manifest, six original Goals unchanged, four composed prompts contain exact original Goal bytes |

Coverage: manual-only wire shape; changed-input and path-escape refusal; identical
paired input payloads; explicit model requirement; independent exact-digest held
review and `ready_for_review` host receipt; readable native report/artifact
evidence; no invented fake-worker session target; duplicate start/reconcile;
artifact tamper; foreign runtime; cross-stage check spoofing; missing synthetic
label; at most two additional writer/editor rounds; repeated-finding halt;
one-hour expiry before approval; crash after native report settlement and two
Store/DB restarts without redispatch or receipt duplication.

During development, scoped checks exposed and resolved fixture construction and
TypeScript issues. One intermediate rerun failed to import a sandbox policy file
while another worker was creating that source seam; after it existed, the pinned
prompt tests passed. These intermediate failures are not physical provider results.

One fixture-only cleanup request was refused: `Store.deleteAutomation` on the
unused default coordinated definition in the disposable test profile returned
`Coordinated automations keep their run history; archive them through the coordinated path.`
The removal was denied before execution and reported to the coordinator. The
request was removed; the default fixture record is preserved, with no delete or
archive bypass. Normal temporary-fixture disposal remains the existing harness
lifecycle. No live record was targeted.

## Integration findings and remaining work

The runtime worker owns the manual-only schema/persistence and native app
composition. It added a supported `ready_for_review` success state after the
package identified the old hardcoded `completed` result. It is also fixing parent
criterion selection and report-contract check lists to honor target child and
namespace, following the package's cross-stage-check finding. The final combined
gate must include those sibling-source changes; these hashes cover this packet's
owned files only.

The manifest remains `runnable: false`. Before any physical run the coordinator
must prove the integrated containment and attempt-scoped report broker, bind the
exact isolated profile/workspace/input authority and idempotency keys, pin actual
Codex model/effort and a positive estimated ceiling/estimate callback, then use
the real native capability. The test-only model name and numeric budget are
fixtures, not selections for execution. Actual provider usage and cost are unknown.

No proof is claimed for provider readiness, authenticated physical reporting,
real process-tree stop, arbitrary tool-network denial, credential isolation,
per-role write restriction, live terminal navigation, clickable artifact
navigation, hidden viewport rendering, installed-package support or the paired
baseline. Those exact remaining physical steps and payloads are in ACCEPTANCE.md.
The package cannot synthesize an enforcing sandbox policy or replace it with
prompt text. No current backlog item or factual news story has been selected.
