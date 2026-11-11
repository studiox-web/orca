# Outcome-oriented parent/child automations

Status: isolated source implementation, the identified blocking corrections, and the hidden combined XOS app journey are complete; physical native/provider and installed-runtime acceptance remain pending. See [Source milestone closure](#source-milestone-closure-november-11), [Implementation completion plan](#implementation-completion-plan), and [Lessons and deferred upgrades](#lessons-and-deferred-upgrades).

Date: 2026-11-08

Decision owner: Graham

Original design authorization: implementation, migration, scheduling, and execution were **not granted**. Graham subsequently authorized isolated implementation using Orca workers. Graham subsequently approved the isolated hidden Playwright/CDP app tests and integration, commit and push to `xos` on November 11. Live migration, scheduling changes, publishing and deployment remain unauthorized. Runtime observations and boundary statements in the original design below describe the design investigation, not the subsequent worker build.

## Recommendation

Build one reusable, native Orca capability before adapting DJVibe: a parent Automation owns a versioned set of child worker definitions, and opening that parent shows both the configured workers and the workers active in a particular run. A parent run should materialize its children as Orca's existing orchestration Run, Tasks, and Dispatch attempts. Orca should not introduce a second worker engine or turn seven worker definitions into seven top-level scheduled automations.

The first reversible slice should define and render the parent/child contract behind a feature flag, with test fixtures only. It should not dispatch workers. Later slices can connect that contract to existing orchestration, add recovery and semantic receipts, package the tuned DJVibe workflow without rewriting its prompts or scripts, and then run a non-publishing shadow comparison. Any live migration or publication remains a later, separately approved decision.

## Graham's idea in plain English

An Automation should be able to describe a finished outcome, not merely one prompt invocation. Graham opens one parent, sees its already configured specialist workers inside it, edits the role, prompt, agent/model, and appropriate execution policy for each worker, and clicks into a live worker when a run is active. Dependencies make only ready workers runnable. Reviewers can return findings, authors can fix them within explicit limits, and a stopped run can resume from durable evidence instead of replaying every stage.

This changes the product ordering:

1. Design and build reusable native Orca parent/child support.
2. Add execution, result, recovery, and visibility in bounded stages.
3. Repackage one already tuned workflow—DJVibe article publishing—as the first pilot.
4. Shadow-test it against the current workflow on identical isolated inputs.
5. Require a manual evaluation decision before any live migration.

It is not an instruction to compose an ad hoc article pipeline now.

## Scope and evidence rules

The labels below are deliberate:

- **Verified** means observed in the installed Orca runtime, this source checkout, a named read-only worktree, or the DJVibe source and tests.
- **Proposed** means behavior that does not exist as a verified end-to-end capability today.
- **Unknown** means the evidence inspected does not establish the behavior; it must not be assumed during implementation.

No operational script was executed. The only runtime inspections were read-only CLI/list/help calls and a filtered `crontab -l`. No automation, worker, schedule, app, publisher, backup, deployment, or external write was started or changed.

There is a version boundary:

- **Verified, installed:** the Orca CLI reports `1.4.253`; its version-matched local guides and help establish the available CLI operations.
- **Verified, source:** the checkout baseline was clean at `81bcc6bc9ab59e79643c0578c0ab1e79f2474ef4`, and its `package.json` says `1.4.214`. Source-level type and UI findings below describe this checkout, not a guarantee about every installed-runtime implementation detail.
- **Verified, DJVibe scheduling:** the current crontab contains the article-loop and daily-production entries as comments marked `PAUSED FOR ORCA MIGRATION 2026-11-04`. That observation is not permission to install, uncomment, replace, or delete them. Independent backup entries were left alone.

## Current-state inventory

| Concept                              | Verified capability                                                                                                                                                                                                                                                                                                         | Boundary relevant to this design                                                                                                                                                             | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automation definition                | A durable definition has name, prompt, agent, surface, extra agent arguments, destination/project/workspace, setup, session reuse, precheck, schedule/timezone, missed-run policy, and enabled state.                                                                                                                       | It represents one top-level invocation. It has no durable child-definition graph or outcome acceptance contract.                                                                             | [`src/shared/automations-types.ts`](../../src/shared/automations-types.ts), [`AutomationEditorDialog.tsx`](../../src/renderer/src/components/automations/AutomationEditorDialog.tsx), [`AutomationEditorSettingsSidebar.tsx`](../../src/renderer/src/components/automations/AutomationEditorSettingsSidebar.tsx)                                                                                                                  |
| Automation run                       | Run history records dispatch state, workspace/session, output snapshot, error, precheck, usage, dates, and occurrence folding.                                                                                                                                                                                              | `completed` is execution completion, not proof that an intended business outcome passed acceptance. The run does not carry a complete immutable definition/child snapshot.                   | [`src/shared/automations-types.ts`](../../src/shared/automations-types.ts), [`AutomationRunHistory.tsx`](../../src/renderer/src/components/automations/AutomationRunHistory.tsx), [`AutomationRunDetailsPage.tsx`](../../src/renderer/src/components/automations/AutomationRunDetailsPage.tsx)                                                                                                                                    |
| Orchestration Run                    | Installed CLI supports create/use/current/list/show. A run namespaces a coordinator and its work.                                                                                                                                                                                                                           | It is not itself a scheduled Automation or a verified always-on coordinator daemon. Retired `coordinator-start`/`coordinator-stop` commands do not supply that guarantee.                    | installed `orca orchestration --help` and version-matched `coordinator-loop` guide; [`types.ts`](../../src/main/runtime/orchestration/types.ts)                                                                                                                                                                                                                                                                                   |
| Task                                 | A task has a stable ID, parent, dependencies, specification, status, and result; ready tasks can be selected from dependency state.                                                                                                                                                                                         | The current result is a string, not a validated artifact/effect schema. A Task is a unit of work, not a reusable editable child definition.                                                  | [`types.ts`](../../src/main/runtime/orchestration/types.ts)                                                                                                                                                                                                                                                                                                                                                                       |
| Dispatch/worker attempt              | `worker-start` creates a supervised attempt with exact run/task/dispatch and assignee identities; retry links to the same Task with `retry-of`; decision gates and ask/reply messaging exist. Dispatch start failures circuit-break after three failures.                                                                   | Dispatch is an attempt, not the worker configuration. A successful worker report is not by itself semantic acceptance of the parent outcome.                                                 | installed orchestration guides; [`types.ts`](../../src/main/runtime/orchestration/types.ts)                                                                                                                                                                                                                                                                                                                                       |
| Attempt observation                  | Process/turn, artifact/git, worker-report, acknowledgement, and liveness facets are projected separately. Outcomes include `outcome_unknown` and `finished_unverified`.                                                                                                                                                     | This is strong recovery evidence, but there is no verified parent-outcome receipt assembled from domain receipts.                                                                            | [`attempt-observation-types.ts`](../../src/main/runtime/orchestration/db/attempt-observation-types.ts), [`attempt-outcome-projection.ts`](../../src/main/runtime/orchestration/db/attempt-outcome-projection.ts)                                                                                                                                                                                                                  |
| Clickable live worker UI             | A coordinator/worker session can show Managed by, Managing, and Talking with rows, status, current task, latest activity, pending question, and an open target for chat, terminal, or dispatch. Exact rows can be opened through host-aware navigation.                                                                     | The crew panel is session-centric. Automation detail does not currently show durable child definitions and their run attempts together.                                                      | [`orchestration-crew.ts`](../../src/shared/orchestration-crew.ts), [`OrchestrationCrewPanel.tsx`](../../src/renderer/src/components/orchestration-crew/OrchestrationCrewPanel.tsx), [`CrewRowView.tsx`](../../src/renderer/src/components/orchestration-crew/CrewRowView.tsx)                                                                                                                                                     |
| Unified Goals/Automations work       | The `unified-goals-interface` worktree adds a read-only, authority-qualified read model across Goals, native automations, scripts, and external records. Schedule children, lifecycle, migration state, warnings, and run outcome remain separate.                                                                          | It does not provide nested executable workers. It should remain a consumer of exact identities, not become a copied catalog or second scheduler.                                             | read-only worktree `../unified-goals-interface`, especially `src/shared/unified-automation-types.ts` and `xos/UNIFIED-AUTOMATION-SURFACE-PLAN.md`                                                                                                                                                                                                                                                                                 |
| Related XOS work                     | `migration-of-automation-goals` and `xos-stage-*` contain staged Goal/run ideas.                                                                                                                                                                                                                                            | These are read-only branch evidence, not installed guarantees or authority to merge. The `xos-stage-b-goal-entity` worktree already has an unrelated local modification and was not touched. | read-only worktrees named in the request                                                                                                                                                                                                                                                                                                                                                                                          |
| DJVibe Goal runner                   | Goal frontmatter selects agent/model/reasoning, and `run-goal-cron.sh` preserves per-goal and shared-lane locks, log capture, status, and JSONL run receipts. `run-goal.sh` expands the tuned prompt and detects some silent provider-limit exits.                                                                          | An exit code or agent report does not prove article quality or publication. Nested execution is explicitly directed through the lock-preserving cron wrapper.                                | [`run-goal-cron.sh`](/home/djvibe/projects/djvibe.com/automations/bin/run-goal-cron.sh), [`run-goal.sh`](/home/djvibe/projects/djvibe.com/automations/bin/run-goal.sh)                                                                                                                                                                                                                                                            |
| DJVibe article identity and receipts | The durable backlog resumes one exact active article, records claims/transitions, and completes only after matching production state with IDs, URL, timestamps, and SHA-256 evidence. Local staging verifies its database row. Production uses independent locks, backup guards, fingerprints, and public URL verification. | These are authoritative domain safeguards. A coordinator may cite and validate them but must not replace, synthesize, or bypass them.                                                        | [`BacklogStateService.php`](/home/djvibe/projects/djvibe.com/app/Services/Automation/BacklogStateService.php), [`StageApprovedDraft.php`](/home/djvibe/projects/djvibe.com/app/Console/Commands/StageApprovedDraft.php), [`run-production-daily.sh`](/home/djvibe/projects/djvibe.com/scripts/run-production-daily.sh), [`publish-content-production.sh`](/home/djvibe/projects/djvibe.com/scripts/publish-content-production.sh) |

### What exists already

The reusable foundation is substantial: scheduling and run history, explicit destination/workspace controls, native Run/Task/dependency/Dispatch identities, supervised workers, retry lineage, decision gates, attempt observation, clickable live worker routes, and domain-specific DJVibe locks and receipts.

The missing piece is not “how to start seven agents.” It is a versioned definition layer that owns children under one Automation, snapshots that definition into a run, maps children to native Tasks/Dispatches, validates structured results and domain receipts, and exposes both configuration and execution in one Automation detail surface.

## Control ownership

Parent, child definition, parent-run snapshot, and dispatch attempt are different records. The UI should not flatten them into one form.

| Control or fact                                              | Parent Automation                                 | Child definition                             | Particular run/attempt                         | Status/reasoning                                                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------- | -------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Name, outcome, acceptance criteria                           | Owns                                              | May contribute stage acceptance              | Frozen copy                                    | **Proposed.** One parent expresses the finished outcome.                                                                          |
| Enabled/paused                                               | Owns scheduling eligibility                       | Optional stage-disabled flag, not a schedule | Run can be paused/cancelled independently      | Parent enablement must not silently terminate a running snapshot.                                                                 |
| Schedule, timezone, missed-run policy                        | Owns                                              | No independent schedule in the first design  | Occurrence is recorded                         | A child schedule would recreate top-level automation ambiguity. A reusable child could be promoted separately in a future design. |
| Run Now                                                      | Starts one parent run                             | No top-level Run Now                         | A selected failed/blocked stage may be retried | Stage retry must reuse the Task and create a new Dispatch attempt.                                                                |
| Parent precheck                                              | Owns run admission                                | May define a stage precondition              | Result and evidence recorded                   | Current precheck is scheduled-run-only; child readiness is a separate concept.                                                    |
| Destination host/project/workspace/base/setup                | Supplies defaults                                 | Inherits or explicitly overrides each field  | Resolved values frozen                         | Existing local/remote and folder-workspace behavior must be preserved. Do not assume git worktrees.                               |
| Session reuse                                                | Supplies default                                  | Explicit override where meaningful           | Exact session ID recorded                      | Reuse is execution policy, not worker identity. A stale session must not import old acceptance state.                             |
| Role and responsibility                                      | Describes coordinator/owner                       | Owns                                         | Frozen label                                   | **Proposed.** Stable child identity must not be derived from the label.                                                           |
| Prompt                                                       | May contain coordinator policy                    | Owns inline text or exact source reference   | Resolved content plus digest frozen            | Edited prompt affects future runs only. Tuned file-backed prompts remain source assets.                                           |
| Agent/provider, model, reasoning/effort, surface, extra args | Supplies allowed defaults                         | Owns explicit selection/override             | Resolved launch config frozen                  | These are current parent controls that also make sense for a worker. Unsupported combinations must be rejected before dispatch.   |
| Dependencies and readiness condition                         | Owns graph constraints                            | Declares incoming dependencies/condition     | Evaluated against accepted results             | **Proposed.** Dependency success means accepted stage evidence, not just process exit.                                            |
| Timeout, retry, review/fix limits                            | Supplies ceilings                                 | May narrow them                              | Counters and deadline frozen                   | A child cannot expand beyond parent/global safety ceilings.                                                                       |
| Concurrency/mutation lane                                    | Supplies total limits                             | Declares mutation class/lane                 | Lease/lock observations recorded               | Orca policy supplements but never replaces script/domain locks.                                                                   |
| Output/result schema                                         | Owns common envelope version                      | Owns stage payload schema                    | Returned result validated                      | Human-readable report remains alongside structured data.                                                                          |
| Current owner, progress, activity, question                  | —                                                 | —                                            | Owns                                           | This is live attempt state, not editable definition state.                                                                        |
| Artifacts, findings, blockers, approvals, effect receipts    | Defines required categories                       | Defines stage requirements                   | Owns actual evidence                           | Historical evidence is immutable and linked to exact attempt/config.                                                              |
| Stop, retry, abandon, resolve gate                           | —                                                 | —                                            | Owns                                           | These controls must never mutate the reusable definition.                                                                         |
| Delete                                                       | Deletes/archives parent only after impact preview | Removes/tombstones for future revisions      | Historical snapshot remains                    | Never erase run history when configuration changes.                                                                               |

Every inherited field should show `Inherited from parent` or `Overridden here`, with a one-click reset to inheritance. Blank must not ambiguously mean either.

## Proposed native-Orca design

### 1. Extend Automation; do not create another orchestrator

**Proposed:** keep the existing Automation as the scheduling and navigation root and add a kind such as `single` or `coordinated`. A coordinated definition contains:

- a stable parent Automation ID and monotonically increasing definition revision;
- an outcome contract: human statement, machine-checkable acceptance items, required approvals, and allowed final states;
- inherited execution defaults and global time/cost/concurrency/failure ceilings;
- versioned child definitions with stable IDs, roles, prompt sources, launch configuration, dependencies, mutation class, stage acceptance, and result schema;
- explicit publication/effect policy, defaulting to no external mutation;
- retention and artifact-reference policy.

The existing single-prompt Automation remains valid and needs no synthetic child migration.

### 2. Snapshot configuration before execution

**Proposed:** starting or scheduling a coordinated Automation atomically creates:

1. an AutomationRun with `automationDefinitionRevision` and a complete resolved snapshot;
2. one native orchestration Run linked by exact ID;
3. one native Task per included child definition, with native parent/dependency edges;
4. a mapping from `childDefinitionId` to `taskId`; and
5. Dispatch attempts only when a Task is ready.

The exact identity chain is:

`automationId / definitionRevision / automationRunId / orchestrationRunId / childDefinitionId / taskId / dispatchId`.

Labels, prompt similarity, paths, schedule text, or timestamps are not identities.

Configuration edits create a new revision and affect future runs. An in-flight run continues its frozen snapshot. Removing a child tombstones it for future revisions but leaves history navigable. The first implementation should not offer “apply edits to not-yet-started stages”; that is deceptively complex. A later explicit fork/replan operation could create a new run revision after showing the exact diff and requiring approval.

### 3. Use orchestration as the execution substrate

**Proposed:** extend the existing Automation dispatcher/reconciler so it materializes and observes native orchestration records. It should use existing ready-task selection, `worker-start`, exact Dispatch addresses, retry lineage, ask/reply, decision gates, observation facets, and crew open targets.

This thin coordination layer has deterministic duties:

- resolve the frozen graph;
- dispatch only ready Tasks within limits;
- validate results and domain receipts;
- mark stage acceptance separately from worker/process completion;
- open bounded fix Tasks or escalation gates;
- persist a semantic completion receipt; and
- on restart, reconcile orchestration records plus domain state before doing anything.

Agent reasoning may choose or explain work within policy, but must not own the only copy of graph state, counters, approvals, or effect evidence.

### 4. Structured result plus readable report

**Proposed common envelope:**

```json
{
  "schemaVersion": 1,
  "automationRunId": "...",
  "orchestrationRunId": "...",
  "childDefinitionId": "...",
  "taskId": "...",
  "dispatchId": "...",
  "definitionRevision": 3,
  "resolvedConfigDigest": "sha256:...",
  "outcome": "succeeded|failed|blocked|uncertain",
  "summary": "Human-readable result",
  "artifacts": [{ "kind": "draft", "uri": "repo-relative-path", "sha256": "..." }],
  "checks": [{ "id": "editor-gate", "outcome": "passed", "evidence": ["..."] }],
  "effects": [{ "kind": "local-stage", "status": "verified", "receipt": "..." }],
  "blockers": [],
  "reportMarkdown": "..."
}
```

The coordinator validates exact IDs, active attempt, revision/config digest, schema, freshness, allowed artifact locations, artifact existence/digests, required checks, and effect receipts. A stale or superseded attempt may remain in history but cannot satisfy a stage. An accepted worker report means only that the attempt reported; parent completion requires the acceptance contract.

### 5. Completion receipt

**Proposed:** a parent run is complete only when Orca persists a receipt containing the exact identity chain, frozen config digest, selected outcome item identity, each acceptance item and its evidence, required approvals, unresolved warnings, domain effect receipts, and the final state.

For the DJVibe pilot, useful final states are distinct:

- `ready_to_publish`: editor-approved, media-complete, locally staged and verified, with no production claim;
- `published_verified`: allowed only after separate publication authority and only when the existing production state and public evidence match exactly;
- `blocked`, `failed`, or `outcome_uncertain`: never displayed as completed.

An exit status, a worker's “done,” a local preview URL, and a public publication receipt are four different facts.

## Proposed Automation experience

Opening a coordinated Automation should keep current Overview and Run history concepts and add native child visibility:

### Overview

- outcome and acceptance criteria;
- schedule, timezone, enablement, next occurrence, missed-run policy, and parent precheck;
- destination and inherited defaults;
- global cost/time/concurrency/failure limits;
- latest semantic outcome, kept separate from lifecycle and schedule state.

### Workers

- ordered or graph-grouped child definitions with role, prompt source/digest, agent/model/effort, inherited/overridden controls, dependencies, mutation boundary, timeout/retry/review policy, and enabled-for-next-revision state;
- edit and impact-preview controls;
- validation for cycles, missing dependencies, incompatible launch options, multiple unguarded writers, and unattainable acceptance criteria;
- no independent schedule control in the first design.

### Runs

- each run shows its definition revision and outcome item;
- graph/list rows show ready, queued, active, waiting for approval, blocked, accepted, superseded, failed, uncertain, and skipped-with-reason separately;
- each stage shows current owner, attempt count, progress/activity, artifacts, review findings, blockers, approvals, cost/time, and acceptance evidence;
- `Open worker` reuses the existing chat/terminal/dispatch open target rather than inventing a second worker viewer;
- retry/stop/resolve controls operate on the selected run/Task/attempt, never the definition;
- historical runs continue to render their frozen worker names and settings after later edits.

These are **UI proposals**. The existing Automation detail and crew panel supply components and navigation behavior, but do not currently provide this combined surface.

## Review, fix, and escalation limits

**Proposed defaults for a pilot, configurable within system ceilings:**

- at most 2 review/fix iterations per artifact;
- at most 1 active fixer per artifact;
- distinct author and approving reviewer identities; an author cannot approve its own final work;
- parent wall-clock and cost budgets plus per-stage timeouts;
- maximum child concurrency, with a stricter single-writer limit for mutation lanes;
- at most 3 failed Dispatch starts, retaining the existing circuit-break behavior;
- no automatic retry after an uncertain external effect;
- escalation when the same material finding repeats, an acceptance result regresses, a limit is reached, or evidence conflicts.

The coordinator stops the loop as accepted, blocked/failed, uncertain, or waiting for a human decision. “Try again until it works” is not a policy.

## Recovery and duplicate-effect rules

| Failure                        | Required behavior                                                                                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coordinator/app crash          | Reload the frozen run snapshot, native Task/Dispatch observations, and domain receipts; recompute readiness; do not infer completion from memory.               |
| Worker timeout or process exit | Preserve attempt evidence. If no accepted report exists, classify as unverified/unknown and retry only when policy and mutation safety allow.                   |
| Duplicate message/report       | Deduplicate by exact Dispatch/message identity. Revalidate but do not create another stage completion or side effect.                                           |
| Stale worker result            | Keep it visible, reject it from acceptance when Dispatch/config/revision no longer matches the active attempt.                                                  |
| Lock unavailable               | Record blocked/waiting state and the existing lock evidence. Never bypass or replace the lock.                                                                  |
| Expired coordinator lease      | A new coordinator generation first reconciles active attempts and effects; only then may it claim work. Script/domain locks remain authoritative for mutations. |
| Uncertain external write       | Stop the lane. Query the existing durable receipt and exact external state. If the outcome cannot be proved, require human resolution; never blindly replay.    |
| Configuration edit during run  | Current run stays on its frozen revision. The edit appears as the next revision only.                                                                           |
| Restart after partial success  | Accepted Tasks remain accepted when their artifacts and receipts still validate. Resume only unmet/invalidated dependencies.                                    |
| Publication retry              | Match exact backlog item, local/production IDs, slug, fingerprint/SHA values, URL, and published state before considering another apply.                        |

## DJVibe as the first later pilot

### Preserve the real workflow

The tuned Goal files remain callable assets, not text to copy casually into a new prompt:

- [`content-trend-researcher/GOAL.md`](/home/djvibe/projects/djvibe.com/automations/goals/content-trend-researcher/GOAL.md)
- [`content-writer/GOAL.md`](/home/djvibe/projects/djvibe.com/automations/goals/content-writer/GOAL.md)
- [`content-editor/GOAL.md`](/home/djvibe/projects/djvibe.com/automations/goals/content-editor/GOAL.md)
- [`content-media/GOAL.md`](/home/djvibe/projects/djvibe.com/automations/goals/content-media/GOAL.md)
- [`content-publisher/GOAL.md`](/home/djvibe/projects/djvibe.com/automations/goals/content-publisher/GOAL.md)
- [`content-loop-retrospective/GOAL.md`](/home/djvibe/projects/djvibe.com/automations/goals/content-loop-retrospective/GOAL.md)

`run-content-loop.sh` documents a manual debug/replay path and a bounded editor/writer loop. It invokes the underlying goal runner directly and must not be mistaken for the production coordinator or evidence that all lane locks are preserved across the whole loop. The lock-preserving contract lives in `run-goal-cron.sh`. The pilot should call existing wrappers/tools with exact contracts, or use safe adapters in shadow mode; it should not rewrite their internals merely to fit Orca.

### Actual dependencies, not an invented mandatory chain

- Feed sync and research create candidate material. Research can continue as an upstream activity; a bounded article run selects one exact input/brief.
- Editor pitch/brief triage precedes writing for a selected item.
- Media context must be prepared before the writer where the current Goal requires it.
- Writer and editor form a bounded revision loop; `editor_approved` is a real gate.
- Media completion follows editorial approval and owns/resumes one durable active queue item.
- The current publisher creates/verifies a local preview only. Production publishing is a separate system with separate locks, backups, receipts, and authority.
- Retrospective is a conditional/weekly feedback loop, not a mandatory stage for every article outcome.
- The real Goal wrappers use the shared `content` lane, and the durable backlog has one exact active article. The initial pilot should therefore remain serialized at mutation points. Parallel source checks or evaluations can be considered later only in isolated outputs with proven merge semantics.
- Independent backup/retention work remains independently scheduled and has no dependency on a coordinator receipt.

### Existing stage contracts to retain

| Stage/tool                 | Inputs                                                             | Outputs and success evidence                                                                                        | Mutation boundary                           | Lock/lease                                                    | Retry safety and durable identity                                                                                                                                     | Existing approval/gate                                                     |
| -------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Feed sync/research         | Feeds, research memory, current briefs/pitches                     | Bounded research packet, briefs/pitches, source links; changed files plus goal run receipt                          | Repository content/feed state               | Goal `content` lane when wrapper is used                      | Reconcile existing topics/files; exit 0 alone is insufficient and fuzzy title matching is not identity                                                                | Research explicitly does not draft or publish                              |
| Editor pitch/brief triage  | Exact candidate/brief and sources                                  | Structured brief readiness, originality/deduplication and editorial findings                                        | Brief/pitch files                           | `content` lane                                                | Resume exact path/identity; do not create a duplicate candidate to retry                                                                                              | Editor gate                                                                |
| Media context preparation  | Selected brief/topic and media inventory                           | Context written to the exact brief with required fields                                                             | Brief file                                  | Existing script/goal lane                                     | Validate current file state and expected fields before replay                                                                                                         | Writer must not proceed when required context fails closed                 |
| Writer                     | Ready brief, sources, media context, revision findings             | Draft artifact with frontmatter/content digest and human report                                                     | Draft files                                 | `content` lane                                                | Retry against the same draft and findings; WIP limit remains; file existence is not acceptance                                                                        | Cannot self-approve; editor review required                                |
| Editor draft gate          | Exact draft and evidence                                           | `editor_approved` or `revision_requested` plus fact/source, originality, voice, metadata, media, and audit findings | Draft metadata/audit files                  | `content` lane                                                | Revalidate the same digest; a later edit invalidates prior approval unless policy says otherwise                                                                      | Required editorial approval                                                |
| Media                      | Editor-approved draft and exact queue item                         | Media-ready manifest/cover evidence or blocked state with retry condition                                           | Media/library/manifests and durable backlog | `content` lane plus backlog state lock                        | Claim/resume the existing active item; transitions are atomic. Some unattended web-search cases are currently blocked and must escalate rather than fabricate success | Media-required gate before local staging                                   |
| Local publisher/stager     | Approved, media-ready draft; slug/byline/category/local ID         | `DJVIBE_LOCAL_STAGE_RESULT` plus verified local DB row, post ID, slug, local URL, changed flag, draft SHA           | Local preview DB/media                      | `content` lane and existing application safeguards            | Same slug/local post is idempotent in normal mode and preserves owner edits; rewrite modes have additional gates                                                      | Local preview only; no production authority                                |
| Production daily/publisher | Exact active backlog item, local post, approved hashes/fingerprint | `DJVIBE_PUBLISH_RESULT`, durable production state, public URL verification, exact IDs/SHA values                    | Remote production DB/media/public site      | Separate daily lock and production-writer guard; backup guard | Reconcile exact fingerprint, IDs, slug, URL, and durable receipt before retrying an uncertain apply                                                                   | Separate `--apply` authority; outside initial pilot and not authorized now |
| Retrospective              | Feedback, run evidence, five Goal contracts                        | Bounded improvement findings/patch proposals                                                                        | Goal/status/memory files                    | Own Goal wrapper/lane                                         | Event/feedback identity, not article-stage completion                                                                                                                 | Conditional/weekly; not required for each article                          |

Relevant contract tests include [`DailyBacklogContractTest.php`](/home/djvibe/projects/djvibe.com/tests/Unit/DailyBacklogContractTest.php) and [`StageApprovedDraftTest.php`](/home/djvibe/projects/djvibe.com/tests/Feature/Commands/StageApprovedDraftTest.php). They should be extended only when a future implementation is authorized.

### Pilot parent outcome

**Proposed initial outcome:** “For one exact selected DJVibe article input, produce an editor-approved, source-audited, non-duplicate article with complete media and a verified local preview, ready for a human publication decision.”

Acceptance requires exact artifact digests, editor approval from a distinct worker, source/fact checks, duplicate-topic check, media-ready evidence, local stage receipt and verified row, no unresolved critical findings, and no production effect. A future `published_verified` extension is a separate authorization and must consume the existing production receipt rather than declaring success itself.

## Throughput is not concurrency or cadence

**Proposed parent policy fields should remain distinct:**

- requested outcome target, such as a bounded number of accepted articles per period;
- maximum items in flight;
- maximum workers active;
- single-writer/mutation-lane concurrency;
- publication cadence and allowed windows;
- backlog and topic-deduplication policy;
- provider/site rate limits;
- quality and failure budgets;
- stop/escalate thresholds.

A target of seven articles does not imply seven concurrent workers or seven publications in one burst. The scheduler admits work only when quality capacity, failure budget, backlog state, duplicate checks, and mutation lanes allow it. This exploration does not select an actual DJVibe target or alter today's throughput.

## Non-publishing shadow pilot

The shadow pilot happens only after the reusable capability and safe execution path are implemented and separately approved.

### Setup

1. Freeze five representative, owner-approved input fixtures: a timely news item, an analytical piece, an event/lineup item, a draft needing revision, and a case with unavailable/ambiguous media.
2. Record exact Goal/prompt digests, model/provider settings, source packets, and tool versions.
3. Run the current workflow and proposed coordinator against identical copies in isolated temporary repositories and ephemeral local databases. Use the same tuned prompts and equivalent model settings; randomize/blind output labels for review.
4. Redirect every artifact to isolated paths. Replace production publication with a deterministic fake adapter. Do not run `run-production-daily.sh --apply` or `publish-content-production.sh`, do not install another schedule, and do not point at live storage.
5. Keep the current live schedule and backup systems untouched. The pilot is an evaluation job, not a duplicate publisher.

### Measurements

- blind editorial quality and DJVibe fit;
- factual/source accuracy and unsupported-claim count;
- topic/slug/content duplication;
- acceptance rate and critical-finding count;
- elapsed and active-worker time;
- provider cost/tokens;
- human interventions and decision time;
- review/fix iterations;
- resume point and replayed work after injected failure;
- artifact/receipt traceability and completeness.

### Failure injection

Each implementation must be tested with: worker crash after artifact write but before report; timeout; duplicate result/message; stale late result; unavailable and apparently expired lock; app/coordinator restart; configuration edit during a run; repeated review finding; and a fake external adapter that returns an uncertain write before later exposing either a matching receipt or no receipt.

### Proposed pass/fail gate

The pilot passes only if all of these hold across all five fixtures:

- zero live or unauthorized external effects and zero duplicate mutations;
- zero false `complete` outcomes;
- 100% of injected failures classified correctly, with the expected resume/escalation behavior;
- 100% of accepted stages traceable to exact config, attempt, artifact digest, and required receipt;
- no critical factual/source error in accepted output;
- zero duplicate-topic/slug acceptance within the fixture set;
- blind median editorial score no more than 5% below the current workflow and no lower on more than one fixture;
- median cost and time each no more than 20% above the current workflow unless Graham explicitly accepts a documented quality/audit tradeoff;
- human interventions and review iterations do not increase on more than one fixture;
- all uncertain fake effects stop for reconciliation rather than replay.

These thresholds are proposals for approval before the test. Passing does not authorize migration. Graham receives the paired results, failures, cost/time data, and audit evidence and makes a manual proceed/revise/stop decision.

## Unsupported assumptions and remaining gaps

The following must be treated as unsupported until built and verified:

- a durable nested child-definition graph in native Automations;
- a persisted link from AutomationRun to orchestration Run/Tasks/Dispatches;
- immutable resolved configuration snapshots for Automation runs;
- structured task result/artifact/effect contracts in core orchestration;
- a semantic outcome receipt distinct from technical run completion;
- a restartable automatic coordinator/reconciler for scheduled parent runs;
- child-level schedules or a safe reason to add them;
- automatic application of configuration edits to an in-flight run;
- core cost/time/review/concurrency budgets enforced across a graph;
- an unattended success path for every current DJVibe media-search case;
- permission to run the production publisher or convert `ready_to_publish` into `published_verified`;
- equivalence between the newer installed runtime and every source shape in this older checkout;
- availability of related XOS worktree features in the installed application;
- an actual future article target, concurrency, publication cadence, or migration date.

## Smallest reversible adoption path

1. **Contract slice:** add versioned parent/child shared types, validation, identity rules, cycle checks, frozen-snapshot types, and test-only fixtures behind an off-by-default feature flag. No persistence migration or execution.
2. **Read-only product slice:** render Workers and fixture-backed Run graph sections in Automation detail, reusing current controls and crew navigation primitives. No dispatch.
3. **Persistence slice:** store coordinated definitions/revisions and immutable run snapshots with migration/rollback tests. Existing single Automations remain unchanged.
4. **Orchestration adapter:** materialize one fixture parent as native Run/Tasks/Dispatches; preserve exact identities and keep effects disabled. Add structured result validation.
5. **Recovery slice:** add deterministic reconciliation, bounded retries/review loops, uncertainty gates, and crash/failure-injection tests.
6. **DJVibe package:** reference the existing Goal files and wrappers, document exact stage contracts, and create isolated adapters. Do not change the prompts, crontab, backlog, production scripts, or backups.
7. **Shadow evaluation:** run the five-fixture non-publishing comparison and present the manual decision packet.
8. **Migration proposal only:** if the pilot passes, inventory exact live schedule ownership and propose an idempotent drain/cutover/rollback plan. Never enable old and new schedulers together.
9. **Publication extension:** only after separate authority, add production reconciliation and verify publication through existing receipts and public state.

## Detailed implementation and verification plan

### Delivery strategy

Implement this as a sequence of independently reviewable changes, not one large branch that introduces storage, execution, UI, and DJVibe migration at once.

- Keep the feature flag off by default until the product and recovery gates pass.
- Preserve the current single-prompt Automation as the default kind and prove it remains byte-for-byte compatible at the API boundary.
- Make schema changes additive and versioned. Do not convert existing definitions automatically.
- Use the existing Automation store for definitions/runs and existing orchestration store for Run/Task/Dispatch state. Persist exact links; do not copy orchestration history into a second store.
- Keep all effect-capable adapters denied in tests and early development. The first runtime tests use fake workers and fake effects only.
- Require a passing exit gate before beginning the next phase. A later phase may reveal a contract defect and send the work back; it must not silently patch around it.
- Treat DJVibe packaging, shadow evaluation, live scheduling, and publication as four different decisions.

### Orca implementation fan-out

The future build should itself be coordinated as one visible Orca orchestration Run. This is an implementation workflow for building the feature; it is separate from the parent/child Automation capability being built.

The build coordinator should create the complete Task DAG first, start every ready independent worker, and let Orca wake it when workers ask questions or report completion. It should not poll workers or steer through their terminals. Each editing worker gets an Orca-managed isolated worktree so concurrent work cannot collide. The coordinator integrates one accepted worker result at a time into the approved implementation worktree, reruns the relevant cross-cutting checks, and then starts newly ready Tasks.

No model is fixed by this design. Each Task gets an explicit agent/provider when dispatched, but a model override should be supplied only after Graham or the implementation owner chooses one. Worker specs must include the exact target, allowed files, constraints, dependencies, expected commit/diff, focused checks, and evidence required for `worker_done`.

#### Planned worker assignments

| Task/worker                   | Assigned chunk                                                                                                                   | Dependencies                                                   | Primary edit ownership                                                                                                 | Required result                                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| A — Contract worker           | Phase 0 decisions translated into shared types, schemas, graph validation, snapshot resolution, and RPC contracts                | Approved Phase 0 decisions                                     | New concretely named `src/shared/coordinated-automation-*` modules and narrowly required existing shared/RPC files     | Commit/diff, schema examples, focused unit-test exit evidence, and list of unresolved contract questions          |
| B — Persistence worker        | Versioned definitions, immutable snapshots, exact Automation/orchestration link records, migrations, retention                   | A accepted and integrated                                      | Automation/profile persistence and migration modules; no renderer or dispatcher edits                                  | Migration/round-trip/crash-boundary/idempotency evidence and compatibility statement for existing profiles        |
| C — Definition UI worker      | Workers editor, inherited/overridden controls, graph/list validation, impact preview, read-only historical fixture views         | A accepted and integrated                                      | Renderer Automation definition/detail components, localization, component fixtures/tests                               | Component-test evidence plus desktop/mobile light/dark hidden-renderer screenshots                                |
| D — Test-harness worker       | Deterministic clock/scheduler, fake worker provider, fake artifact/effect adapters, crash points, trace assertions               | A accepted and integrated                                      | Test-only harness and fixtures; no production execution logic                                                          | Harness API, self-tests, proof that no live provider/effect path can be reached                                   |
| E — Materialization worker    | AutomationRun → orchestration Run/Task/Dispatch materialization, exact mappings, ready-task dispatch, concurrency/mutation lanes | B and D accepted and integrated                                | Existing Automation runtime plus narrowly scoped orchestration adapter modules                                         | Fake-worker integration evidence, duplicate-trigger tests, and native CLI/read-model compatibility evidence       |
| F — Result/recovery worker    | Structured result admission, semantic acceptance, bounded loops, reconciliation, uncertainty and completion receipts             | E accepted and integrated                                      | Result validator, reconciler, completion receipt modules and their tests                                               | Full failure-injection matrix with deterministic exit evidence and zero duplicate fake effects                    |
| G — Live-run UI worker        | Run graph/list, worker activity, artifacts/findings/gates, clickable exact attempts, retry/stop controls                         | C and F accepted and integrated                                | Renderer run detail components and orchestration crew integration; no definition schema changes                        | Component/hidden-Electron evidence covering current, historical, blocked, and uncertain runs                      |
| H — Cross-platform/E2E worker | Local/remote/folder workspace, mobile, authority, restart, and end-to-end regression coverage                                    | F and G accepted and integrated                                | New focused tests and fixtures; production changes only when a testability seam is missing and coordinator approves it | Headless Electron, runtime integration, and platform-contract results with exact commands/exits                   |
| I — Independent review worker | Read-only architecture, safety, identity, UX, migration, and test-coverage review                                                | A–H integrated and green                                       | No edits                                                                                                               | Findings by severity with exact locations, unsupported claims, and ship/block recommendation                      |
| J — Foundation fix worker     | Resolve accepted review findings, routed by the coordinator to the owning chunk rather than patched ad hoc                       | I findings accepted                                            | Only files assigned by the coordinator; preferably the original owning worker receives the follow-up                   | Focused regression evidence and finding-by-finding closure report                                                 |
| K — DJVibe packaging worker   | Pilot manifest/adapters referencing tuned Goals and existing safeguards; isolated fixtures; production denied                    | Foundation review passes and Graham authorizes pilot packaging | Orca pilot package/test fixtures; DJVibe sources remain read-only unless separately authorized                         | Prompt-digest parity, stage-contract tests, isolated-output proof, and no-live-change diff                        |
| L — Shadow evaluation worker  | Run the approved five-fixture comparison, collect metrics and failure traces                                                     | K accepted and separate shadow-run authorization               | Isolated pilot outputs and evaluation report only                                                                      | Complete comparison packet against the fixed pass/fail gate; no recommendation hidden by aggregate scores         |
| M — Pilot review worker       | Independently verify the shadow evidence and adoption recommendation                                                             | L complete                                                     | No edits to live systems                                                                                               | Proceed/revise/stop recommendation with evidence gaps and explicit statement that migration is still unauthorized |

Tasks A, B, E, and F are deliberately serialized because they define and consume the same authoritative contracts. After A is integrated, C and D can run in parallel with B because their file ownership is separate. G waits for both definition UI and recovery semantics. H tests the integrated product rather than independently inventing behavior. K–M do not exist in the active Run until the foundation and authorization gates permit them.

#### Coordinator responsibilities

The implementation coordinator owns integration rather than feature code:

1. Create one Orca Run with the approved objective and all currently authorized Tasks/dependencies.
2. Dispatch every ready independent Task to its assigned isolated Orca worker/worktree.
3. Keep the shared contract and acceptance criteria in each worker spec; do not rely on chat memory.
4. Answer worker questions through Orca ask/reply or escalate material product decisions to Graham.
5. Accept only `worker_done` reports with the required commit/diff and check evidence. A worker timeout or silence is not completion.
6. Inspect and integrate accepted changes in dependency order, preserving unrelated work and resolving overlaps before releasing dependent Tasks.
7. Run the smallest necessary cross-cutting checks after each integration and the full changed-file gate at the end.
8. Send review fixes back to the owning worker when possible. Do not create an untracked coordinator patch pile.
9. Create explicit decision gates before DJVibe packaging, shadow execution, schedule migration, and any publication capability.
10. Report each Task outcome, evidence, and blocker to Graham; never collapse partial or uncertain results into “done.”

#### Future Orca command shape

When implementation is separately authorized, the coordinator should resolve the session's Orca CLI, load its version-matched orchestration guide, and use the then-current command help. The present runtime's shape is:

```text
ORCA orchestration run-create --objective "Build coordinated parent/child Automations behind a disabled feature flag"
ORCA orchestration task-create --spec "<self-contained worker assignment>" --deps '<task-id-json-array>'
ORCA orchestration task-list --ready --brief
ORCA orchestration worker-start --task <task-id> --worktree <Orca-managed-isolated-worktree> --agent <agent>
```

The executable name, repository ID, worktree mode, Task IDs, agent, and any model are resolved at execution time; these placeholders must not be run literally. The coordinator starts ready workers, then yields and waits for Orca wake messages rather than polling.

### Phase 0 — settle the contracts

**Build/design work**

- Record an implementation decision for the parent/child identity chain, definition revisioning, frozen run snapshots, inherited defaults, and explicit overrides.
- Decide the initial outcome/acceptance schema, result envelope, artifact URI rules, effect status vocabulary, and approval identity rules.
- Confirm that the initial child definition has no independent schedule.
- Decide prompt storage: inline, exact source reference, or both. A source reference must resolve to content plus a digest in the run snapshot.
- Define what is deterministic policy versus coordinator-agent judgment.

**Verification**

- Walk three fixtures on paper: one linear graph, one graph with two read-only parallel children, and one writer/reviewer bounded loop.
- Trace a configuration edit during each run and prove the old snapshot remains sufficient to render and resume it.
- Trace every final state and show that `complete` cannot be reached without the required acceptance evidence.

**Exit gate**

Graham approves the terms and initial control ownership. Every field has one authoritative owner, stable identity, serialization form, and compatibility rule. No code or storage migration is required to reach this gate.

### Phase 1 — shared definitions and validation

**Build**

- Extend the shared Automation contract with an additive `coordinated` kind.
- Add concretely named modules for parent outcome contracts, child definitions, resolved snapshots, structured worker results, and completion receipts.
- Add graph validation for duplicate child IDs, missing dependencies, cycles, disabled required children, incompatible launch settings, unattainable acceptance criteria, and multiple unguarded writers in the same mutation lane.
- Resolve parent defaults into explicit per-child snapshot values and retain override provenance for the UI.
- Extend RPC schemas without weakening validation for existing single Automations.

**Focused tests**

- Current Automation JSON still parses and serializes unchanged.
- A coordinated definition round-trips without losing stable IDs or override provenance.
- Reordering or renaming a child does not change its ID.
- Cycle, missing dependency, invalid model/agent combination, forbidden child schedule, and unsafe writer graphs fail with actionable errors.
- Resolution is deterministic: the same definition revision produces the same canonical snapshot digest.
- Updating a parent default changes only inheriting children in the next revision.
- Editing a child leaves an already-created snapshot unchanged.

**Exit gate**

Shared typecheck and focused unit tests pass. No persistence, scheduler, dispatcher, or UI code consumes the new kind yet. The feature flag remains off.

### Phase 2 — persistence and immutable history

**Build**

- Extend the authoritative Automation persistence path for coordinated definitions, monotonic revisions, and immutable resolved run snapshots.
- Persist exact mapping records for AutomationRun ↔ orchestration Run and childDefinition ↔ Task only after those orchestration records exist.
- Use an atomic create/idempotency key so a duplicate scheduler delivery cannot create a second parent run.
- Tombstone removed child definitions in later revisions without removing their historical snapshots.
- Make retention preserve a completion receipt and the minimum referenced evidence needed to explain a historical outcome.

**Focused tests**

- Load profiles from before the new schema and prove existing Automations and runs are unchanged.
- Save/reload multiple revisions and prove each run renders from its own snapshot.
- Simulate a write failure at each persistence boundary and prove no half-linked run becomes dispatchable.
- Deliver the same occurrence twice and prove exactly one AutomationRun is created.
- Remove and rename children, restart, and prove old run history still resolves.
- Exercise local, remote-authority, and folder-workspace identities without assuming a Git worktree.

**Exit gate**

Migration, round-trip, crash-boundary, owner-fencing, and idempotency tests pass. Existing Automation scheduling tests remain green. The runtime still refuses to execute coordinated definitions.

### Phase 3 — definition editor and read-only detail UI

**Build**

- Add a Workers section to Automation create/edit and detail views using existing design-system tokens and controls.
- Show the role, prompt, agent/model/effort, destination/workspace policy, dependencies, acceptance requirements, and inherited/overridden state for each child.
- Add validation summaries and graph/list presentation without requiring a visual node editor.
- Add an impact preview that distinguishes changes to future definitions from the frozen active run.
- Render fixture-backed historical runs and child snapshots read-only. Do not add Dispatch controls yet.

**Component and rendered checks**

- Add focused React tests for adding, editing, reordering, disabling, and deleting/tombstoning children.
- Test reset-to-inherited versus explicit blank/none values.
- Test keyboard navigation, accessible names, validation focus, long prompts, long model names, and duplicate labels with different stable IDs.
- Add presentational fixtures for empty, configured, invalid, active-run, blocked, and historical-revision states.
- Render desktop and mobile widths in light and dark themes. Verify no clipping and that controls remain usable without hover.

**Exit gate**

The UI can create and inspect a valid definition, but cannot execute it. Component tests and hidden fixture screenshots pass review. Current single-Automation editor/detail behavior remains unchanged when the flag is off.

### Phase 4 — native orchestration materialization

**Build**

- Extend the existing Automation dispatcher to atomically create one orchestration Run and one Task per included child from the frozen snapshot.
- Store exact mappings and native dependency edges; use Task IDs for work and Dispatch IDs for attempts.
- Dispatch only ready Tasks through the existing worker-start path.
- Enforce parent concurrency and mutation lanes before dispatch while preserving all existing downstream locks.
- Start with a deterministic fake worker provider and an effect policy of `deny`.

**Integration tests**

- A linear fixture creates the expected one Run, Tasks, dependencies, and first Dispatch exactly once.
- A diamond graph starts only dependency-ready read-only Tasks in parallel and joins only after both are accepted.
- A single-writer graph never has two active attempts in the same mutation lane.
- Duplicate scheduler, coordinator, and worker-start requests do not duplicate Runs, Tasks, or Dispatches.
- A retry creates a new Dispatch linked to the same Task and prior attempt.
- A configuration edit after run creation does not change launch settings for queued Tasks.
- A destination refusal, unsupported model, or unavailable workspace blocks before launch with a visible reason.
- Existing Run/Task/Dispatch CLI and crew readers can inspect the materialized records without a compatibility fork.

**Exit gate**

Fake workers can complete a no-effect graph using native orchestration identities. All orchestration invariants and existing single-Automation dispatch tests pass. No real agent or script is needed for this gate.

### Phase 5 — result validation, bounded loops, and recovery

**Build**

- Admit the structured result envelope through the existing worker-report path while retaining the readable report and old report compatibility where required.
- Validate identity, snapshot digest, attempt freshness, schema, artifacts, checks, approvals, and effects before accepting a Task.
- Add deterministic reconciliation that derives the next action from persisted Automation, orchestration, artifact, and effect evidence.
- Implement bounded review/fix iterations, time/cost ceilings, start-failure circuit breaking, self-approval rejection, and human decision gates.
- Persist semantic completion receipts separately from technical process completion.

**Deterministic test harness**

Create an in-process harness with:

- a fake clock and scheduler;
- temporary Automation and orchestration stores;
- a scripted fake worker provider;
- a temporary artifact store with controllable digests and missing/stale files;
- a fake effect adapter with `not_started`, `applied`, `verified`, `uncertain`, and `denied` states;
- explicit crash points after every durable write and before every acknowledgement; and
- an event trace that can assert exact identities and ordering without sleeps.

**Failure-injection matrix**

| Injected condition                              | Required assertion                                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Worker exits before writing an artifact         | Task is failed/unverified; no downstream Task starts.                                                                          |
| Artifact is written but report is lost          | Restart discovers the artifact but does not accept it without a valid report/receipt. Safe retry policy decides the next step. |
| Report is committed but acknowledgement is lost | Duplicate delivery reuses the same report identity and creates no duplicate acceptance or effect.                              |
| Late report from superseded attempt             | Report remains auditable but cannot satisfy the active Task.                                                                   |
| Artifact digest changes after approval          | Approval is invalidated or the run blocks; completion receipt is not issued.                                                   |
| Reviewer and author identity are the same       | Final approval is rejected.                                                                                                    |
| Review limit is reached                         | Run escalates once and does not create another fix attempt.                                                                    |
| Cost/time/concurrency limit is reached          | No new Dispatch starts; active policy and escalation state are visible.                                                        |
| Lock is unavailable                             | Run waits/blocks without bypassing or stealing the domain lock.                                                                |
| Coordinator crashes at every write boundary     | One replacement generation reconciles to the same next action with no duplicate effect.                                        |
| Effect adapter returns uncertain                | Mutation lane stops; restart queries exact external state before any retry.                                                    |
| Exact matching effect receipt later appears     | Effect becomes verified without replay.                                                                                        |
| No matching receipt appears                     | Run stays uncertain and requires a human decision.                                                                             |
| Definition is edited mid-run                    | Current snapshot/digest and Task launch inputs remain unchanged.                                                               |

**Exit gate**

Every injected failure has a deterministic passing test. Zero scenario produces false completion or a repeated fake side effect. Restarting at any crash point converges to the same safe state.

### Phase 6 — live run UI and operator controls

**Build**

- Add the run graph/list to Automation detail with stage status, owner, attempts, activity, questions, findings, artifacts, approvals, spend/time, and semantic acceptance.
- Reuse orchestration crew open targets for `Open worker`.
- Add run-scoped stop, retry, resolve-gate, and inspect-receipt controls with impact previews and authority checks.
- Keep definition editing visibly separate from run control.
- Show technical process state, stage acceptance, parent outcome, schedule state, and lifecycle independently.

**UI and end-to-end checks**

- Confirm clicking a configured child opens its definition; clicking an active attempt opens the exact chat/terminal/dispatch.
- Confirm retry acts on the selected Task/run and never edits the child definition.
- Confirm a historical run still renders after child rename/removal.
- Confirm pending questions, blockers, uncertain effects, and human gates are visible without opening raw logs.
- Verify keyboard-only use, screen-reader labels, desktop, mobile, remote-host labels, folder workspaces, and duplicate child labels.
- Run the Electron app only in the background with hidden-renderer Playwright/CDP checks; never activate a desktop window.

**Exit gate**

The complete fake-worker journey is operable from the parent Automation and every worker is clickable. Hidden-renderer screenshots and headless Electron tests prove the expected state transitions without stealing focus.

### Phase 7 — package DJVibe without migrating it

**Build**

- Create a versioned pilot manifest that references the existing Goal files and wrapper contracts by exact path and digest.
- Implement adapters that translate coordinator inputs/results without changing Goal prompt text, queue identity, locks, receipts, or approval fields.
- Add an isolated output root, temporary database, fake production effect adapter, and fixture copies of required feed/article/media state.
- Represent research and retrospective according to their actual conditional/asynchronous roles, not as mandatory per-article stages.
- Set the pilot final outcome to local-preview-ready or artifact-ready only after Graham chooses; production stays denied.

**Contract tests**

- Prompt digests match the tuned source files used by both comparison arms.
- The same exact article fixture identity flows through every stage.
- `editor_approved`, media-ready evidence, local-stage receipt, hashes, and local row are required exactly as documented.
- A Goal/script exit 0 without the intended artifact/receipt cannot accept a stage.
- The queue resumes the same active item after restart and cannot claim a second item.
- Backup and production jobs are absent from the pilot graph and unchanged in source/configuration.
- Attempts to invoke a production apply path fail closed in the harness.

**Exit gate**

The packaged pilot passes all contract tests against isolated fixtures. A file/config diff proves no tuned prompt, live schedule, backup, production script, or live content changed.

### Phase 8 — shadow evaluation and manual decision

Run the already defined five-fixture comparison only after explicit pilot authorization. Capture the current-workflow and coordinated-workflow outputs, exact prompt/model digests, costs, elapsed time, interventions, review iterations, failure-recovery traces, and completion evidence. Apply the pass/fail gate in this brief without relaxing it after results are known.

**Exit gate**

Produce a signed-off comparison packet with `proceed`, `revise and repeat`, or `stop`. A passing shadow test proves only that a live migration proposal may be prepared; it does not authorize schedule adoption or publishing.

### Phase 9 — optional live adoption proposal

If the shadow decision is `proceed`, separately inventory actual schedule owners and draft a cutover plan with drain, preflight, disabled-first installation, single-owner verification, rollback, and observation windows. Preserve all independent backups and production escape hatches. This phase ends at a proposal unless Graham separately authorizes the live change.

### Verification commands for implementation work

Exact focused paths will follow the modules created in each phase. The expected command pattern is:

```bash
source /home/djvibe/.nvm/nvm.sh
nvm use 24
node --version
pnpm --version

pnpm test path/to/coordinated-automation.test.ts --maxWorkers=2
pnpm tc:node
pnpm tc:cli
pnpm tc:web
pnpm exec oxlint path/to/changed/files
pnpm exec oxfmt --check path/to/changed/files
```

For presentational and hidden Electron validation:

```bash
pnpm fixtures:shot <coordinated-automation-fixture-id> --theme both
ORCA_BACKGROUND_LAUNCH=1 pnpm exec playwright test \
  tests/e2e/coordinated-automation.spec.ts \
  --config tests/playwright.config.ts \
  --project electron-headless \
  --workers=1
```

After the last implementation edit/rebase and before any authorized push:

```bash
ORCA_CODE_QUALITY_BASE=<actual-pr-base> pnpm check:changed --maxWorkers=2
```

`check:changed` is the final repository gate, not a substitute for the focused identity, recovery, UI, and failure-injection tests above. If it fans out or times out, report the exact completed checks and exit evidence; do not call it passing.

### Definition of done

The reusable functionality is ready for a shadow pilot only when all of the following are true:

- one parent opens to show editable configured children and separately shows clickable live attempts;
- every run is tied to an immutable definition revision and exact native orchestration identities;
- dependencies, limits, approvals, structured results, and semantic receipts are enforced rather than merely displayed;
- configuration changes affect future runs and leave active/history snapshots intact;
- duplicate triggers/messages/reports and every injected crash produce no duplicate side effect;
- uncertain effects stop for reconciliation;
- single Automations, local/remote hosts, folder workspaces, mobile layout, and authority-qualified identities retain coverage;
- the feature flag remains reversible and off by default until the product gate;
- focused tests, typechecks, formatting/lint, rendered fixtures, hidden Electron E2E, and final changed-file checks all have successful exit evidence; and
- no live DJVibe prompt, schedule, publisher, backup, or content state was used or changed to obtain that evidence.

## Open decisions

- Should child prompts be stored inline, by exact file reference, or both with resolved snapshot and digest? DJVibe favors source references plus snapshots.
- Which parent outcome/acceptance fields are generic enough for core Orca versus an extension schema?
- Should a child definition be reusable across parents, or copied with provenance? The first slice should keep ownership local to one parent.
- Which agent/provider is the coordinator, and which decisions must remain deterministic main-process policy rather than model judgment?
- What artifact URI schemes and retention periods work across local, remote, and folder workspaces?
- Does a future replan fork the run or create a new revision-linked run? It should not mutate history.
- How should XOS's unified read model display a coordinated parent and child count without confusing children with scheduled top-level Automations?
- Is the first pilot outcome local-preview-ready or merely artifact-ready in a fully ephemeral database? No live test should begin until Graham chooses.
- What targets, budgets, and cadence are appropriate after evidence exists? None are inferred here.

## Copy-paste prompt for the first future step

> **Not authorized to run now.** In a new approved Orca worktree, implement only the first reversible contract/UI slice for coordinated Automations. Extend the existing native Automation model with an off-by-default `coordinated` kind, stable versioned child definitions, inherited defaults with explicit overrides, dependency validation, outcome/acceptance schema, and immutable run-snapshot types. Add test-only fixtures and a read-only Workers section in Automation detail showing role, prompt source, agent/model/effort, dependencies, override provenance, and example historical snapshot data. Reuse existing Automation controls, design tokens, and orchestration crew open-target types. Preserve exact authority-qualified identities and keep lifecycle, schedule state, technical run state, and semantic outcome separate. Do not dispatch a worker, add a scheduler/coordinator service, migrate an existing Automation or Goal, run DJVibe scripts, change prompts, change crontab or automation state, publish, deploy, push, or alter backups. Use Node 24 and pnpm 12.14.0, add focused validation/tests, and report unsupported runtime assumptions explicitly.

## Boundary confirmation

The only repository deliverable/source change is this Markdown design file in the independent worktree. It did not implement the feature, package or run the DJVibe pilot, dispatch workers, modify other worktrees, change any live Automation or schedule, publish content, touch production, or couple/alter independent backups and recovery safeguards.

## Implementation completion plan

This addendum records the later authorized build. The preceding boundary confirmation applies to the original design investigation. Accepted code is integrated only in the independent coordinator branch through `0556c733c8e`; it has not been deployed. Contracts, persistence, definition UI components, the test harness, native materialization, recovery, definition RPCs, isolated fake-run host/RPCs, selected-profile authority, shared startup composition, and the renderer/save checkpoint have passed scoped review. The host review includes post-stop write fencing and exact validation of every exposed Dispatch and its bounded retry ancestry. The combined host/API passed 52 tests and Node typechecking; the later profile/API selection passed 36 tests. The renderer's final create-intent correction passed 11 coordinated-save and 38 existing destination-save tests plus web typechecking. Component captures cover desktop/mobile, light/dark, keyboard use and overflow. Startup composition passed 33 focused tests and an isolated main/preload/renderer build. Web typechecking also passed after combining these checkpoints. These are exit-0 source/component checks, not proof of an operable Electron app journey.

The read-only integration audit (`task_c5989a127cac`) found six remaining connections. Work ownership and acceptance are now explicit:

| Connection                                    | Owner / ordering                                                                                    | Evidence required                                                                                                                                                                                                           |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dedicated definition API and host capability  | Accepted and integrated at `d7a22f38426`                                                            | Existing coordinated schemas reach Store create/update through native RPC; durable save/reload, exact owner/revision fences, capability refusal before writes; definitions remain disabled.                                 |
| Definition save/reopen and worker activity UI | Renderer/save checkpoint accepted through `1b4309a16ca`; live observations are a separate next task | Complete definition fields survive save/reopen; child IDs are stable; uncertain creation retries preserve the original request and later edits; unavailable actions show reasons.                                           |
| Manual isolated fake-run entrypoint           | Host/RPC accepted; shared startup and isolated fixture entry accepted at `c43f36f6611`              | One idempotent AutomationRun and native Run/Tasks/Dispatches from the frozen snapshot; ordinary startup supplies no opt-in. Actual Electron startup remains untested.                                                       |
| Durable recovery attached to app lifetime     | Host lifecycle and nested-profile binding accepted; hidden same-profile restart test staged         | Profile-scoped durable state; startup reconciliation before new work; same IDs and accepted receipts after a process restart; uncertain effects cannot replay.                                                              |
| Selected-run projection and operator bindings | Renderer API binding integrated at `8159fd827d4`; native session bridge remains incomplete          | Authority-qualified snapshot, native observations, validated progress and receipts; stale responses discarded; host-checked action availability; exact native worker destinations. A fake Dispatch alone is not a session.  |
| Hidden end-to-end app journey                 | Prepared fixture; Electron launch paused while the required `electron` skill is unavailable         | Actual create/save/reopen, held fake run, configuration edit, exact worker navigation, refusal checks, same-profile process restart, and persisted accepted receipt; fixed viewport/theme; zero real provider/effect calls. |

Key integration locations are `src/main/runtime/rpc/methods/automations.ts`, `src/shared/rpc-contract/coordinated-automation-params.ts`, `src/shared/automation-runtime-capabilities.ts`, `src/main/runtime/workspaces/persisted-surfaces/automation-api-operations.ts`, renderer `automation-orca-save.ts` / `automation-save-action.ts`, `src/main/automations/runtime-automation-service.ts`, `service.ts`, and `run-completion-watcher.ts`. Use existing RPC CRUD rather than adding another preload IPC write path. Reuse native crew open targets and `open-agent-message-sender.ts` for navigation.

The accepted run API exposes `automation.startCoordinatedFakeRun`, `automation.inspectCoordinatedRun`, and `automation.reconcileCoordinatedFakeRun`, with the separate `automation.coordinated-fake-runs.v1` capability and host-owned availability. The default app bootstrap supplies no fake-run injection. Packaged builds, remote/headless hosts, mismatched profiles, disabled feature settings, and real worker providers are refused. Stop, retry, human resolution, findings, limits, and native session destinations are explicitly unavailable where backing evidence or implementation is absent. These are implementation gaps, not completed controls. The next app integration must use the actual accepted RPCs and an isolated profile; it must not make a mock-only component journey stand in for a functioning parent Automation.

The renderer now binds those three APIs from the parent detail panel, integrated at `8159fd827d4`. It checks current host availability, retains exact uncertain request identities, reads matching history/receipts before replay, discards delayed responses after selection changes, and clears displayed evidence after host refusal. Matching historical snapshots remain read-only. Request bookkeeping lasts for the Automations page lifetime; durable history and receipts remain host-owned, and renderer destruction does not retain that bookkeeping. The worker's real Store/RPC transaction regressions, component/projection checks, web typecheck, isolated DOM-spec typecheck and scoped quality gates passed. Four fixed desktop/mobile light/dark captures passed overflow and keyboard checks; the coordinator inspected desktop dark and mobile light captures. The added `coordinated-app-renderer.spec.ts` is prepared and typechecked, not executed. This checkpoint does not complete native worker navigation or the full app journey. After integration, the coordinator ran the real transaction, host panel and observation-scope selection on the combined branch: all 26 tests across three files passed with exit 0.

The active-profile correction compares the injected root with both the independently selected startup profile directory and the Store directory; Electron's outer user-data directory is not a profile identity. The isolated entry uses the same `startMainProcess` and singleton runtime/service as the ordinary entry, with a separate `out-coordinated` build and effects denied. Exact prepared commands and unrun checks are recorded in [the isolated app checkpoint](../../tests/e2e/coordinated-automation-harness/coordinated-app-checkpoint.md). The required `electron` skill was absent from the installed CLI and local skill roots. Using the repository's existing hidden-window Playwright/CDP instructions as a substitute has been asked of Graham but is not yet authorized; no Electron launch has occurred.

Clickable native sessions still need a reviewed bridge from the coordinator's existing starting Dispatch to Orca's native placement, readiness, authority and custody facilities. The public `orchestration.workerStart` allocates a Dispatch and therefore cannot simply be called after the coordinator already allocated one. The internal launch path is now extracted into `src/main/runtime/rpc/methods/orchestration/worker/prepared-worker-dispatch-launch.ts`, integrated at `6785ef2b21a`. The coordinator verified that its launch body is byte-identical to the previous implementation and all five integrated files match the reviewed worker commit. The worker's six-file test selection initially passed 46 of 47 tests; after correcting one new failed-start recovery expectation, all eight tests in that affected file passed. Node typechecking and scoped quality checks passed. The extraction adds no adapter, RPC, capability, or session attachment.

The next backend slice is an isolated native-stub bridge using that prepared Dispatch, with host-owned admission, exact native custody/authority, explicit unknown-start reconciliation, and one report-settlement owner. It must not label a real terminal process `fake_no_effects`, call public worker start to allocate a second Dispatch, trust a worker-supplied session target, or retry a possibly launched process blindly. Ordinary startup and real providers remain disabled; source tests can use controlled fixtures while Electron launch remains paused. Only verified native openability may make a worker clickable. Stop/retry/gate operations and real-provider support remain further explicit implementation work before the full reusable-capability definition of done.

The bridge attempt (`task_6c7005e9d45c`) reported failure without source changes or test runs. Inspection confirmed a prerequisite: `worker-topology.ts` supplies `startupAgent`, `runtime-agent-terminal-startup.ts` rejects a supplied frozen command/config and resolves current Store settings, and `workspace-removal-target.ts` prepares the host account environment. A pinned isolated stub therefore needs a host-internal admitted launch plan through this existing pipeline before the bridge can be built. The narrowed next implementation must keep ordinary agent launch behavior intact and prove refusal before account/spawn effects for fabricated, stale, foreign or overridden plans. Later bridge work must also retain uncertain native custody past an orphan deadline and use authenticated native report ingestion as the single technical settlement owner, followed by separate semantic acceptance. Neither a native adapter nor clickable session authority is implemented by this investigation.

The native launch prerequisite and its two recovery corrections are accepted through `0556c733c8e` (worker stack `3a8cfbc51de8`, `9af4cced6b4`, `b2cf9a0e4b0`). An opaque host-owned permit carries a pinned executable/fixture, fixed arguments and replacement environment through the existing native stages, with validation after pane admission and before physical dispatch. Only existing isolated folder workspaces and the in-process `LocalPtyProvider` are admitted; daemon, SSH, WSL, remote and ordinary app compositions refuse or have no opt-in. No public RPC or shared session-target capability was added. The provider records exact process identity before fallible activation, reports post-spawn failures as uncertain, and suppresses a start announcement after observed exit. Ordinary launch ordering remains unchanged. The coordinator reviewed all 28 stack paths against the worker revision and ran the native-launch, composition-parity and renderer transaction selection on the combined branch: 48 tests across three files passed with exit 0. Worker evidence includes 95 focused tests before the final ordering guard and 57 affected tests afterward, plus Node typechecking and scoped quality gates. These checks use a fake physical PTY; no Electron, real provider or native stub process was launched.

The next backend connection must reuse this admitted launch for the coordinator's existing Dispatch, preserve authenticated native report ingestion as the single technical settlement owner, and feed the existing semantic admission checks separately. It must durably distinguish native uncertain starts/custody from in-process fake timeouts before enabling any retry or restart path. The fake-run public API must retain its no-process contract. Native session navigation, stop/retry/gate controls and an executed app journey are still incomplete; the accepted launcher alone does not provide them.

To reduce repeated review cycles, each fix submission must address the complete finding list and related missing, mismatched, stale, retry, and restart cases together. Reviewers should report all supported blocking findings in one pass, distinguishing optional polish. Run focused regression checks for each change and reuse successful exact-revision evidence; repeat broader suites when changed code or new findings justify them, then run combined integration checks. Safety defects remain blockers, and repeated failure in the same area requires revisiting the implementation approach rather than another superficial patch.

The next completion milestone is the demonstrated isolated no-effect app journey above, with the feature off by default. Component previews or in-process harness success alone do not satisfy it. Real-provider enablement, DJVibe packaging and shadow evaluation, remote execution enablement, and live adoption remain separate later gates; unsupported hosts must refuse safely. No live schedule, publisher, content, or independent backup may be changed to obtain test evidence.

### Consolidated development and verification cadence

Graham asked to reduce the repeated small reviews and build the remaining functionality before the final review. The development cadence is now larger coherent implementation batches, with focused checks during development and one combined acceptance pass. This changes sequencing, not the required evidence or permission boundaries. Tests that catch integration, identity, or duplicate-effect faults stay alongside the code; postponing all tests would hide incompatible assumptions until the end.

- **Backend Kimi worker:** finish the native run connection, host-owned execution/action contracts, exact session projection, stop/retry/gate behavior, and the source wiring needed for normal worker providers. Use existing native launch, custody, report, stop, retry and gate facilities. Commit compatible shared contracts early so the UI worker can consume them without waiting for a separate review cycle. Real provider execution and normal app enablement remain off; use controlled fixtures. A stop request is not proof of process exit, and retry or gate resolution must not erase an uncertain effect.
- **Renderer Kimi worker:** finish the parent run experience against those contracts: visible children and attempts, clickable exact worker activity, blockers/results/receipts and available controls. Keep definition edits separate from run actions. Begin with independent renderer work and coordinate contract dependencies directly through Orca; do not invent a parallel API or fabricate availability while a backend contract is pending.
- **Coordinator:** integrate coherent checkpoints locally, distinguish provisional source from accepted behavior, and resolve shared-contract or ownership questions promptly. Preserve one writer per file area and current worktrees. Do not add a review task for every commit. A concrete known safety defect is still fixed before enabling or relying on the affected behavior.
- **Combined verification:** after both implementation batches are integrated, run the relevant integration and hidden-app journeys, including worker navigation, controls, refusal paths, frozen configuration, restart, uncertain outcomes, and zero duplicate effects. Then run one independent review of the combined revision, collect all supported findings, fix them in batches, and rerun affected checks. The missing required Electron skill/test-method question remains unresolved; no app launch is authorized by this cadence change.

The existing review of `8d85d4bbb7e` remains a bounded read-only review of that exact commit. Its findings feed the backend implementation batch rather than create another prerequisite review chain. The commit is a worker-reported checkpoint (13 new tests plus reported regression/type/quality success), not yet coordinator-accepted or installed behavior. The complete reusable feature still requires working native navigation, operator controls, broader compatibility evidence and an executed app journey. DJVibe packaging, shadow runs and live adoption remain later separate gates.

### Combined source checkpoint, November 10

The coordinator provisionally integrated backend commits `8d85d4bbb7e`, `832a1c3d32d`, `2dae43b8347` and renderer commits `4de2f17e9a2`, `d8a3710791b`, `9a44bb077d3`, `ecd72316b64`, `89f6c8aadcd` into this independent branch, ending at `e211b434e00`. The cherry-picks were conflict-free; the two renderer dependency-only imports were skipped because the full backend stack supplies the same shared contracts. Exact comparisons found all 50 backend/shared paths and 24 renderer paths identical to their respective source checkpoints. On Node 24.22.2/pnpm 12.14.0, the combined branch passed `pnpm tc:node` and `pnpm tc:web`, both exit 0. This is integration/type evidence, not final behavioral or app acceptance.

This checkpoint contains native attempt/report/recovery plumbing, host-checked stop/retry/gate APIs, exact native terminal destinations, and their renderer bindings on both parent Automation detail and the selected run-details route. Controls remain unavailable without matching owner/host/frozen-history evidence. The UI worker reported 74 focused tests for the parent bindings and a later 56-test affected selection for the run-details route, plus Chromium fixtures; these overlapping counts are not additive. The backend's reported 223-test checkpoint preceded its later operator/recovery test commit; final combined behavioral verification remains to be run.

The remaining backend packet includes a narrowly admitted stub readiness/ingress implementation (currently uncommitted in its assigned worktree), the promised honest status of guarded normal-provider support, and evidence-backed inspection fields requested by the renderer. The final UI update must consume that packet once, then the combined tests/app journey and independent review can assess the complete implementation. The required Electron skill/test-method issue remains unresolved, so no Electron app journey has run. Fable's backend continuation was denied by its five-hour usage limit; its CLI reported automatic continuation at 6:20 p.m. America/Vancouver. Its unfinished files are preserved and are not represented as integrated or validated. No live automation, schedule, publisher, content, independent backup, installation or deployment was changed.

### Lessons and deferred upgrades

Reusable working practices from this run are recorded in [Coordinated development workflow](../development-workflow.md), following the feature-lifecycle and lessons-documentation patterns used by DJVibe and Cascade. The product upgrade backlog below remains the canonical scope for these proposed capabilities.

Record these lessons in this plan for a later reliability upgrade. They do not extend the current implementation milestone, authorize another worker batch, or change the DJVibe pilot/adoption gates. Revisit their priority after the combined verification and independent review; do not make every improvement below a prerequisite for finishing this build.

**Current finish line.** Finish the assigned backend and renderer batches, integrate them, run focused combined checks and the isolated app journey once its test-method gate is resolved, then perform one independent review and address supported blockers together. Exact Task/Dispatch ownership, frozen configuration, honest unavailable/uncertain states, approval checks, and prevention of duplicate effects remain current acceptance requirements. Any demonstrated violation of those requirements is a current defect, even if discovered through a deferred-upgrade scenario. Richer quota displays, capacity scheduling, and notification organization are later enhancements.

**Observed during this run, November 10.** The backend automatically resumed after the CLI's reported 6:20 p.m. Vancouver reset; the 6:25 coordinator check found it already working, so no continuation message or restart was needed. That wait/resume behavior came from Claude/Fable's CLI. Orca retained the assignment and delivered error escalations; the verification timer was a separately arranged one-time wake. Do not attribute all three behaviors to an existing Orca quota scheduler.

The final backend view packet subsequently arrived at `98a7c66684d`, with pinned stub readiness at `fbf2a41f174`; both were integrated locally through `e3daf977c09`. The renderer was reopened once against that packet. Both workers then reported a new five-hour quota denial and an 11:20 p.m. Vancouver reset. Their Orca summaries still showed `ready` / `input_accepted` with live terminals, which did not prove active model work. Source and unfinished edits survived, but neither assignment had a final completion report. The renderer's reopened launch record omitted an explicit model; its actual assistant receipts confirmed `claude-fable-5-2`. This is an observability/provenance gap, not evidence that the wrong model ran. Relevant retained Run `run_514fd105ba6b` messages are `msg_3e3dee7123a1`, `msg_stop_b7d36bec46134a39654f2f35`, and `msg_stop_0f4d3140f810c671dbe84c86`.

**Proposed later backlog, not implemented behavior:**

| Priority | Upgrade                                     | Proposed behavior and acceptance evidence                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1        | Quota wait visibility and safe continuation | Project a provider-reported quota wait separately from Task lifecycle, terminal liveness, and semantic outcome. Show reset time, timezone, evidence freshness, and whether the provider promises automatic continuation. Reconcile the exact assignment before any authorized nudge. Fixtures cover auto-resume already in progress, a still-denied request, stale reset evidence, restart and duplicate wake-ups; none starts a duplicate attempt or bypasses a denial. |
| 1        | Durable handoff and model provenance        | Carry the exact assignment, requested model/effort, resolved launch configuration, workspace, commit, unfinished-file inventory, test evidence and next step through follow-up/recovery. Distinguish a reused assignment from a new follow-up Task. Verify the selected model where supported and expose unknown provenance otherwise. Tests must preserve dirty work and refuse silent provider substitution; storing a handoff must not itself resume anything.        |
| 2        | Consolidated coordinator notifications      | Group repeated notices about the same exact message/Dispatch transition into one actionable notification with its count and latest state. Preserve the complete audit trail and separate genuinely new blockers. Repeated delivery must neither repeat work nor hide a new failure, question or completion.                                                                                                                                                              |
| 2        | Scheduling that accounts for shared quota   | Admit concurrency against a verified shared allowance pool and priority, not merely the number of workers or model labels. Start with explicit configuration when reliable provider telemetry is unavailable. Unknown capacity stays unknown; a reported reset is not proof of sufficient remaining allowance. Simulate two workers sharing a pool, starvation and interrupted work without account changes, purchases or automatic provider switching.                  |

These proposals must extend native Orca orchestration and observations. Provider quota APIs, reset events, model introspection and durable automatic wake facilities have not been verified as general capabilities; discovering their supported contracts is part of a future design slice. No second scheduler or orchestration framework is selected here.

**Workflow lessons to apply now.** Continue coherent build batches with focused regressions and one final combined review. Settle shared contracts before the dependent UI pass and tie each review to an exact revision and evidence. Resolve required test skills/methods before launching validation; a missing method remains an explicit blocker, not an excuse to substitute component screenshots for app acceptance. These are execution practices for the existing scope, not new product features or authority to launch the app.

### Post-reset integration checkpoint, November 10

Both Fable workers returned completion reports after the next reset. The renderer's final packet is `1692ece2551`, integrated as `89be1fc5f58`; its dependency-only import `d8cfc453595` was skipped because the backend already supplies those five shared files. All 12 renderer implementation paths and five shared contract paths exactly match the renderer checkpoint. The remaining backend recovery tests `7d0a5f87b77` and guarded provider planning `efd10d7f6ad` are integrated as `4d7f8df2ad5` and `f3165da116d`. The reusable development-workflow guide and deferred lessons were committed locally at `6f7817d80d2`. None of these commits was pushed, installed or deployed.

The renderer reports 82 focused tests, web typechecking, scoped quality checks and 26 headless Chromium fixture captures passing. Its report explicitly excludes automated keyboard/overflow checks beyond DOM tests and captures; the captures clip at 900px tall. Artifact URIs are plain text, and findings, limits, spend, elapsed time and live questions remain unavailable. The backend reports 1,195 tests across 86 selected files, Node/web/CLI typechecks, RPC catalog verification and scoped quality checks passing at `efd10d7f6ad`. These are worker reports for their respective revisions, not whole-app acceptance.

Coordinator checks on the combined branch passed with exit 0: web typechecking after renderer integration, the 35-test renderer/operator-RPC selection, Node typechecking after the final backend integration, the 26-test provider-plan/crash-recovery/operator-RPC selection, and the isolated app-spec TypeScript check. The two test selections overlap and their counts are not additive. No Electron app, actual stub binary, physical native PTY or real provider was launched. The installed CLI still reports no `electron` skill, and the substitute test-method decision remains unresolved.

**The execution connection is still unfinished.** The backend report identifies normal-provider support as plan-and-refuse only: no Store-backed host-facts composition, no admitted non-stub launch/report binding, and no real-agent readiness under the system coordinator. The pinned stub also cannot yet submit its own authenticated completion report; the tests submit on its behalf. The immediate fake provider offers no operator approval window because it admits/rejects inside one reconciliation. These are concrete remaining implementation/testability gaps, separate from the deferred quota and notification upgrades. Passing the reported tests does not close them.

The existing backend workspace has therefore received one coherent completion follow-up, Task `task_51bde8486ef5` / Dispatch `ctx_06b98685f998`, preserving Claude/Fable selection and the existing source. It covers authoritative host facts, guarded native launch/report binding, fixture-owned authenticated reporting, and an honest staged approval fixture through the real host/RPC path. Ordinary app/provider execution stays off, the public fake-run API stays process-free, and tests remain emulated/isolated. A missing essential native primitive must be raised explicitly rather than bypassed. The renderer assignment is settled; final combined app verification and independent review remain pending the completed execution connection and the app-test-method gate.

### Native backend completion and renderer handoff, November 11

This checkpoint supersedes the unfinished-source and provider-selection statements in the November 10 checkpoint. Graham selected Codex for all remaining work. Backend Task `task_51bde8486ef5` completed under Dispatch `ctx_633bd805868f` at `b9af48f6f0f`, preserving the preceding Fable commits `82d89fb230b` and `a8e9bf22b0d` and Kimi's unfinished edits. Those three commits are now integrated locally as `851fe31818f`, `28cbac35260`, and `2ef8857e0eb`. All 89 changed backend paths match the final worker revision exactly (Git comparison exit 0); no other checkout was edited by this integration. Nothing was pushed, installed, enabled or deployed.

**Implemented and source-tested:** authoritative Store/runtime/profile/workspace admission, guarded attachment of the existing starting Dispatch to native launch, frozen configuration, early process custody, repeated authority checks across awaited boundaries, retained uncertain outcomes and native report ingress. The actual isolated stub entry now sends its own report through Orca's existing metadata and authenticated transport. Its bundled code and transitive inputs are pinned; the report can attest only the fixture's brief echo, not real editorial or other acceptance checks. Ordinary provider execution remains off, unsupported targets refuse, and public fake-run APIs remain process-free. Native worker completion remains distinct from semantic stage acceptance.

**Approval contract now fixed at the host:** an otherwise valid report can remain durably held for required human approval without another attempt or dependent launch. Inspection exposes optional `stage.pendingApproval` with the exact Dispatch, report digest, gate IDs, hold time and available/unavailable report projection. A stage approval must carry `dispatchId` and `expectedReportDigest` from the candidate Graham actually reviewed, together with its run/revision/owner/authority/stage/Task/gate scope. Reinspection must not silently substitute newer evidence. Artifacts/effect receipts revalidate, self-approval and scope fences remain enforced, waits remain bounded, and uncertain replay retains the original candidate. Parent gates remain separate.

**Verification:** the backend worker's final committed tree passed 214 tests across 21 selected files, Node/CLI/web and entry typechecks, changed-code quality, flaky-pattern checks, full staged-file lint/format and the normal commit hooks, all with exit 0. The final artifact build also reproduced its pinned bundle. Tests evaluated the actual entry in-process with emulated input/transport and authenticated ingress; they did not launch a stub process, physical PTY, provider or app. Earlier intermediate counts are not additive or substitutes for this final evidence. The full suite, final broad changed gate, cross-OS execution and installed behavior remain unverified.

**Remaining build order:** renderer Task `task_71970a45c328` / Codex Dispatch `ctx_79d7ebe9ff23` owns the targeted displayed-candidate approval binding in the existing `outcome-live-ui` workspace. It must preserve the exact payload through delayed submission and unknown-response replay, show held evidence truthfully, and cover both existing run surfaces. Dependency-only shared-file imports are separate from its renderer commit. After that packet, integrate and perform combined checks and one independent review of the complete revision. App verification remains pending: the required `electron` skill is still absent; Graham has been asked whether the prepared hidden-window Playwright/CDP tests may substitute. That question does not authorize any launch until answered. The prepared fake app journey cannot by itself prove real native worker execution or navigation. DJVibe repackaging, shadow evaluation and any live adoption remain later separately approved steps.

**Handoff lesson applied:** native message acceptance did not prove Kimi consumed supplemental instructions. On the Codex reassignment, Graham exited Kimi; the exact terminal showed its exit and a shell prompt before Orca fenced the old assignment. Codex received the current handover as its initial prompt, attached to the same Task, and explicitly acknowledged HEAD, all 27 tracked and five untracked source changes, the approval contract and safeguards before editing (`msg_036cfc87559e`). Future handoffs require that acknowledgement; queued input alone is insufficient. This is a working practice, not a new automatic recovery feature.

### Combined source verification, November 11

The renderer packet completed at `5ca55f49597` and is integrated locally as `362a1e46a0f`. Its dependency-only import `3a115409e8b` was skipped. All 14 renderer paths and five shared contract paths match the worker exactly (Git comparison exit 0). Both live run surfaces now retain the displayed held report and original scope through dialog delay, refresh and uncertain replay; stage approval sends that candidate's Dispatch and digest. Parent decisions stay separate, worker artifact references stay inert, and technically completed workers are shown as awaiting semantic approval when appropriate.

The renderer's exact committed tree passed 92 tests across seven files, web typechecking, quality/flaky-pattern/lint/format checks and normal commit hooks. Its headless component checks used 375×812 and 1280×900 in both themes and verified horizontal dialog bounds, Tab and Escape. The coordinator inspected the mobile-light and desktop-dark captures; these are component fixtures, not the Electron app. On the combined source at `362a1e46a0f`, the coordinator then ran the seven-file renderer/client/host-RPC/held-approval selection: **85 tests passed**, exit 0, and `pnpm tc:web` passed, exit 0. These overlapping counts must not be added to the backend or renderer totals.

Implementation integration is complete for this source batch; final independent source review and the separately gated app acceptance remain. Review will assess the exact combined revision and report all supported blockers together. The missing Electron skill/test-method decision remains pending, so no app, actual stub, physical PTY or provider has been launched. Installed/live behavior and cross-OS runtime operation remain unverified. The design's later DJVibe shadow pilot is not started by this source milestone.

### Gate lifecycle corrections awaiting narrow verification, November 11

The independent review of `c4bea6269eb` / implementation `362a1e46a0f` blocked source acceptance on five concrete issues: a rejection replay could affect a newer attempt; approval could clear a hold before its expired wall-clock budget was enforced; an old rejection hid a newer gate; escalation prevented later explicit resolution; and children sharing a local gate ID collided. The coordinator confirmed the named source paths. These were implemented gate defects, not objections to the intentional default-off policy or the deferred app test. The passing earlier suites did not cover these composed cases.

One Codex worker corrected all five in the combined checkout at `f1614061b623cb246adafd2e66ebc0944fbccadf`. Every stage decision now carries the mapped Task and an explicit `stageCandidate`: `report` with Dispatch/digest, `attempt` with Dispatch, or `no_attempt`. The renderer captures that identity once for approve, reject and escalate; the host never fills an omitted identity from a newer hold. Exact legacy Dispatch/digest pairs remain a checked compatibility input; ambiguity fails closed. A named attempt without a structured report or a genuine no-attempt state permits audit escalation or explicit rejection that fails/halts the run, without inventing report acceptance. Approval still requires the exact available held report. Parent gates remain stage-free.

Current eligibility, observations, acceptance and history use child-local gate identity and the exact candidate. A rejection of A stays in history while B becomes independently resolvable. Requirement escalation is an audit event that permits a later explicit approve/reject; its own replay retains its receipt. Actual halt/escalation acknowledgement never supplies approval or lifts the halt. Duplicate gate IDs within one child or the parent are rejected before execution; separate children and parent may share a local ID. The inclusive frozen deadline (`elapsed >= limit`) is fenced durably before decisions/admission/effects/completion; an already-recorded receipt cannot advance expired work, while an already completed receipt stays stable.

The exact committed source passed **344 tests across 27 files**, Node/web/CLI and isolated fixture typechecks, scoped quality/flaky/lint/format/diff checks and normal commit hooks, all exit 0. New tests first reproduced the failures, then composed both actual live renderer surfaces with the authenticated host/RPC to prove lost rejection A, untouched B on replay, visible B resolution and one dependent release. Restart, shared child IDs, parent escalation, no-report decisions and first-operation deadline cases are included. Earlier test counts overlap and are not additive. Native transport/pinning and provider activation were unchanged. The source is clean and committed; independent narrow verification of these five corrections is next. Full app/physical/installed and cross-OS acceptance remain unrun, and the missing Electron skill/test-method question remains unresolved. No live operation, new worktree, push, merge or deployment occurred.

### Source milestone closure, November 11

**Coordinator verdict: the five identified source blockers are closed at `52df5ce4a3f2a85075718933de89ad7e2db84c8d`.** The independent narrow review accepted findings 1, 3, 4 and 5 at `f1614061b62`, and accepted the original expired-approval trigger while identifying one remaining recovery-query deadline branch. That residual is now corrected: expiry is persisted after the awaited query, checked before a fresh apply authorization, and checked again immediately before the apply call. Observations of already-started work remain durable; expiry does not erase receipts, invent cancellation or authorize replay.

The coordinator read the residual diff and its composed regression tests, inspected the executed failing and passing logs, and verified the exact committed source/test blob IDs against the worker's tested blobs. Only the effect gate and its recovery test changed after the narrow review; the four accepted corrections and shared/UI contracts are unchanged. The two-file delta, working tree and index checks exited 0. This closes the named source finding; it is not an additional claim that an independent reviewer reran the final correction.

The final worker selection passed **99 tests across six files**, with Node and recovery-test typechecks, scoped quality/flaky/lint/format/diff checks and normal hooks, all exit 0. Eleven deadline cases cover query return at/after the limit, permitted recovery just before it, intent persistence reaching expiry, already-in-flight results, late observations, duplicate reconciliation and restart. The broader 344-test evidence at the preceding correction remains applicable only to unchanged code. These overlapping counts are not additive. No full-repository or pre-push gate was run; any later authorized push still requires `pnpm check:changed` after the final edit/rebase.

| Milestone                                               | Current evidence and boundary                                                                                                                                  |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native parent/child source and operator behavior        | Implemented locally; the five identified blockers are closed. Ordinary provider execution remains disabled and unsupported targets refuse.                     |
| Component and composed host/RPC behavior                | Scoped unit, DOM, fixture and recovery checks passed at their recorded revisions. These do not establish installed behavior.                                   |
| Hidden combined app journey                             | Prepared but unrun. AGENTS.md requires the unavailable Electron skill; Graham's decision on the repository's hidden Playwright/CDP substitute remains pending. |
| Physical native stub/provider and cross-OS runtime      | Unrun and outside the current launch authorization. The fake app journey cannot stand in for this evidence.                                                    |
| DJVibe repackaging and non-publishing shadow comparison | Planned later; tuned prompts, scripts, safeguards and independent backups remain unchanged.                                                                    |
| Live adoption, schedules, publishing, deployment        | Not authorized and not performed.                                                                                                                              |

The full review and narrow verification reports, final correction reports and exact command logs are retained under this checkout's `.cache/`. They distinguish independent review from worker test evidence and coordinator closure. This brief remains the tracked account of the implementation state and remaining acceptance gates. No additional source worker is needed for the closed findings.

**Copy-paste next-step prompt — conditional on Graham approving the substitute app-test method; not permission to run now:**

> In the existing outcome-coordinator-exploration worktree, verify the accepted source beginning at `52df5ce4a3f` with the prepared isolated hidden-window Playwright/CDP app journey only after Graham explicitly approves that method in place of the missing Electron skill. Read AGENTS.md and the current `tests/e2e/coordinated-automation-harness/coordinated-app-checkpoint.md`, verify Node 24/pnpm 12.14.0, and inspect the isolated entry/config before running its explicit build and tests. Use ORCA_BACKGROUND_LAUNCH=1, a disposable profile/HOME, fixed viewport and hidden renderers; never launch the ordinary installed profile, real workers/providers, publisher or schedules. Capture exact exit evidence and failures; fix only scoped app integration defects if found. Report which behaviors were actually exercised and keep native physical/provider acceptance, the DJVibe shadow pilot and live adoption separate. No new worktrees, push, merge, deployment, backup changes or live content effects.

### Combined XOS app acceptance and integration, November 11

Graham authorized continued testing, merge into `xos`, commit and push so he can
build and test locally. This supersedes the earlier pending substitute-method and
no-merge/no-push checkpoint. The unavailable Electron skill was replaced, with his
approval, by the repository's prepared isolated hidden Playwright/CDP method.
The original no-live-operation, no-new-worktree and independent-backup boundaries
remain in force.

`origin/xos` was refreshed at `9a312989cab7ed6eb612e695fd7336f852311bfd` and integrated
in this existing checkout. Three conflicts combined the runtime registrations,
RPC registries and Automation detail. Existing XOS fallback controls stay on single
automations; coordinated children keep their own frozen policies and controls.
The primary XOS checkout's unrelated `AGENTS.md` edit is excluded and preserved.

The fixture package was corrected to select the isolated compiled entry explicitly.
The prior helper derived the ordinary package root from a supplied main filename,
so a custom filename alone did not select the custom app. A separate generated
fixture package preserves the app version and entry, with no ordinary-entry change.
The renderer journey also enters the native list through XOS's existing navigation.
Its revision assertion now changes the outcome contract: a coordinator brief alone
is descriptive metadata and does not alter the resolved execution definition.

The combined source passed `pnpm tc`, RPC catalog verification and the isolated
fixture TypeScript check (exit 0). The explicit fixture bundle and Electron runtime
preparation passed (exit 0). Both hidden Electron journeys passed (2 tests, exit 0):
real RPC persistence/restart/idempotency and real DOM create/edit/save/reopen/run
inspection/reconciliation/frozen revision. Tests assert hidden windows, disposable
HOME/profile, disabled definitions and unavailable fake-worker session navigation.
The renderer viewport is 1280 by 900 in dark theme. See the reproducible commands
and precise boundaries in [the app checkpoint](../../tests/e2e/coordinated-automation-harness/coordinated-app-checkpoint.md).
These results complement, rather than add to, the earlier overlapping source test
counts. The required final `check:changed` gate runs after the integration commit;
its exact log and push verification are retained in this checkout's `.cache/`.

This remains an experimental, default-off source milestone. An ordinary packaged
build does not admit coordinated definition writes or activate providers merely
because the UI flag is on. The isolated fixture proves the no-effect app journey;
actual native worker/PTY/provider execution, installed behavior and cross-OS runtime
still need their separate acceptance. DJVibe repackaging and the non-publishing
shadow comparison remain future work. No live automations, schedules, publishing,
content, independent backups or installed application are changed by this acceptance.

### Full-delta gate corrections before push, November 11

The first completed XOS-base gate exposed quality issues missed by narrower worker
comparisons: 192 style/type/React findings, native runtime parameters typed too
broadly, localization coverage/catalog drift, formatting of private scratch files,
and one isolated startup-test failure. Its unit selection passed 975 tests and
failed one across 85 files. This was a failed pre-push gate, not a passing release
check; no push followed it.

One backend/test batch removed all 35 owned casts and 12 broad runtime-parameter
diagnostics while retaining canonical nominal runtime ownership and every existing
capability/identity check. Malformed non-object worker reports now return a
schema-invalid refusal instead of throwing before validation. The isolated startup
test mocks the XOS IPC registration boundary and verifies its Store/runtime handoff;
it does not start a goal queue. That batch passed 152 tests across 12 files and
Node/CLI typechecks with exit 0. The coordinator verified all 15 tested blob IDs.

The parallel renderer batch uses existing component sizes/variants, removes unsafe
casts, preserves action candidate identities, and adds the missing translation
keys without changing existing English text. Meaningful component splits retain
file-size limits. Catalog generation adds 48 protected-copy keys without removing
any; no rule or localization allowlist was weakened. Non-English packs retain
English fallback where translations have not been authored. Full-feature quality
against `origin/xos`, renderer typecheck, localization verification and scoped
lint/format passed with exit 0. The focused selection passed 142 tests across 13
files; an overlapping final affected selection passed 76 across seven. The
coordinator verified all 59 final source/catalog hashes.

The private generated `.cache/` directory is ignored by Git and formatting; no
tracked source, stored evidence or operational safeguard was removed. The final
combined app/gate and push verification remain coordinator-owned and are recorded
in `.cache/xos-final-*` logs. These overlapping worker counts are not additive.
The final gate must compare the full feature to XOS after the last edit/commit.

The rebuilt hidden app journeys also passed on cleanup commit `eac88f4f187` (2
tests, exit 0), and the screenshots were inspected. The combined gate then passed
31 of 32 checks, including the complete 85-file unit selection. Its sole failure
was the Node-only typecheck following a cross-layer test into renderer localization.
The unchanged gate-flow assertions were moved from `src/main/runtime/` into the
existing combined harness as `coordinated-run-gate-flow-rpc.unit.test.ts`, with only
relative imports adjusted. All 17 cases, Node typechecking and the E2E typecheck
ratchet passed there (exit 0). This changes test placement, not app behavior or its
accepted source. The full gate is rerun after this final correction before push.
