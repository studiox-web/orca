# DJVibe article writing shadow pilot

Prepared after Graham rebuilt XOS at `46d5882a055`. The native developer pilot
now has an isolated real-provider launch path and authenticated report transport.
The four-stage real-worker test and retained-profile restart passed; the ordinary installed
profile remains unchanged. Start with [acceptance and setup](ACCEPTANCE.md),
[verified isolation and limits](ISOLATION.md), and the
[input manifest](inputs-v1/input-manifest.json).
The [manifest](pilot-manifest.json) pins the existing six Goal prompts and their
configured models, plus the voice, content and runner contracts. It is preparation
data, not a supported Orca import payload.

## First test

One parent, one article, manual start, isolated draft files, no schedule or
publication. Start with the deliberately synthetic `djvibe-shadow-synthetic-001`
brief. All story names and facts are invented test data. The configured workers
are brief review, media-context review, writer and independent editorial review.
The editor may return concrete findings to the same writer for at most two further
revision rounds. Keep one writer active and preserve the same article identity.
Editing a child definition affects the next run, never the frozen current run.

The first outcome is `ready_for_review`: Graham receives the draft, source packet,
editor findings, revision history and exact artifact receipts. It does not claim
cover-media readiness, a local database preview, `ready_to_publish`, or publication.
Missing source/duplicate evidence, repeated material findings, cost uncertainty or
the one-hour limit stop the run for a decision. The one-hour limit is configured in the frozen run; a physical one-hour
expiration scenario is not part of the short smoke test.

Preserve the original Goal text. A separately versioned pilot scope tells each
worker which operation to perform and which isolated paths it may use. That scope
must not be the security boundary: the host must enforce filesystem, command,
network and credential restrictions. Pin any required persona and craft lessons
when freezing the selected input. Do not silently substitute unavailable models.

## Installed-runtime observation before source integration

Read-only `orca status --json` reported the running app as
`1.4.257+xos.46d5882a055`, ready and reachable. Its capability list lacks
`automation.coordinated-definitions.v1` and
`automation.coordinated-fake-runs.v1`. The version-matched CLI automation guide
documents single-prompt automations, not child-definition import.

The [definition write gate](../../../src/main/runtime/coordinated-definition-write-gate.ts)
requires an injected, matching profile host, the experimental flag and an
unpackaged environment. The [native provider admission](../../../src/main/runtime/native-provider-execution-admission.ts)
also requires a process-local isolated host admission. Neither can be activated by
a normal automation payload. These gates stay intact. No create/run was attempted,
so this is a preflight capability blocker, not a denied or uncertain write.

The source milestone's hidden app tests used fake workers. They do not prove a real
writer will launch, return an authenticated report, or recover in the installed app.

## Preserve the tuned workflow

The real manual wrapper performs production feedback transfer before its feed-sync
option, and later processes pending owner rewrites. `--no-sync` does not make it a
shadow runner. It was inspected, not executed. The manifest records the exact
wrapper digest and the operations excluded from this pilot.

The initial writing test excludes researcher feed ingestion, cover attachment,
local publishing, homepage curation, production promotion and weekly retrospective
mutation. Their prompts are pinned for later packaging, not deleted or replaced.
Existing Goal lane locks, queue locks, stage/production receipts, approval gates,
independent backups and operational recovery paths remain authoritative and unchanged.

## Current implementation and remaining acceptance

The separate trusted developer entry composes Orca's existing coordinator and
native Task/Dispatch execution. It creates one disabled manual-only parent in a
disposable profile, with pinned inputs, real Codex workers and no publisher.
The report-only MCP helper forwards the worker's own result unchanged into
native settlement. Its arguments cannot select another run or RPC operation.

A real brief-review worker has read the fixture, written its artifact and received
an authenticated native completion receipt. That test exposed a missing automatic
completion wakeup. The coordinator now consumes Orca's committed worker_done
notification and reconciles through the existing parent lane. A focused test
proves dependent dispatch, duplicate-wakeup safety, revoked admission and final
native receipt using controlled PTYs. The final four-role native smoke and retained-profile restart passed in about
4.3 minutes. Independent source review cleared all three original blockers. The
exact held run, Tasks, Dispatches and editor report survived reopening unchanged.

The current developer selection is Codex `gpt-6.1-sol`, medium effort, for all
four roles. Original tuned prompt bytes and model frontmatter remain unchanged.
The host estimate is $1 per attempt with a $6 estimated ceiling; this is not
measured spend. Account authentication is copied into a disposable private
provider home, unavailable to command tools; no global account configuration is
edited. The tested command policy allows isolated output scratch but protects
other roles' declared artifacts and previous revisions.

The smoke verified independent editor evidence, exact draft/revision/report
digests, the human approval hold, first-worker navigation, hidden renderers and
owned process cleanup. The 390×844 desktop viewport had a readable report with
its sidebar collapsed; long-title header overlap remains a limitation. No operator
approval was submitted. Final release checks precede the authorized XOS merge/push.
Packaged activation and the newer project-group FolderWorkspace route remain
unverified; see ISOLATION.md. The helper is a developer pilot, not a normal CLI
import or installed-profile enable switch.

The [paired evaluation template](paired-evaluation.template.json) is still
unmeasured. Compare the same frozen input with the scoped manual prompt sequence,
same models and isolation before any workflow migration. Neither arm runs the
operational publisher wrapper. Expand only after the bounded synthetic smoke,
with Graham reviewing the paired evidence before live scheduling or migration.

No existing automation, article, schedule, backup or publishing behavior changed.
Only disposable test profiles and isolated synthetic outputs are used.
