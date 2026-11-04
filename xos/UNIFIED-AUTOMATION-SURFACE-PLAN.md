# Unified Goals, Automations, and Scripts Surface

Status: proposed implementation plan, prepared from source inspection on 2026-11-04. Nothing in this document is implemented merely because it is described here.

Repository location: `xos/UNIFIED-AUTOMATION-SURFACE-PLAN.md`.

## 1. Decision

Build one native-styled Automations surface with:

- one derived list for Goals, Orca automations, deterministic script jobs, and external scheduler jobs;
- one reusable detail/editor shell with type-specific panels and actions;
- one normalized runs view that links back to the authoritative run or artifact;
- the existing native agent selector and provider logos;
- a shared searchable model-picker presentation backed by the model catalog for the selected execution host.

Do not introduce a third scheduler, a second persisted automation catalog, or a copied run-history database. Each existing engine stays authoritative. The renderer obtains a read model that joins those sources and makes ownership explicit.

The minimum first deliverable is a feature-flagged, read-only shared list for local data. It proves identity, folding, filtering, type-specific navigation, and the native visual language before any scheduler migration or script execution is enabled.

## 2. Goals

1. Make the existing native Automations list the common operational entry point.
2. Let an operator scan goals, scheduled agent work, scripts, and external jobs together without losing type or ownership context.
3. Reuse `AgentCombobox` and `AgentIcon` so provider choices have the same logos and interaction as the out-of-box automation editor.
4. Preserve Goal-specific capabilities: contract/status files, org context, inbox/reply actions, queues, live tail, recent receipts, analytics, galleries, and goal lifecycle actions. Goal files and metadata remain authoritative and are not rewritten into generic automation fields.
5. Preserve exact scheduling semantics and scheduler ownership during display, edit, and migration.
6. Keep credentials and model discovery on the execution host.
7. Make script execution an explicit, reviewed, least-privilege workflow rather than treating arbitrary shell text as an ordinary agent prompt.
8. Give every displayed row and run a stable, authority-qualified identity with deterministic deduplication.

## 3. Non-goals

- Replacing the existing native automation scheduler.
- Converting crontab expressions to RRULE silently or editing legacy cron through an RRULE-only form.
- Persisting a new “unified list” or copying all source records into one store.
- Moving provider credentials between local and remote hosts.
- Making the current local-only Goals implementation appear remote-capable.
- Enabling arbitrary scripts on Windows, SSH hosts, or mobile before the runner contract is safe on those targets.
- Removing the Org, Pipeline, Analytics, Tasks → Goals, or Goal Viewer experiences.
- Replacing Goal folders, native automation definitions, crontab, external manager records, or XOS runtime bindings as their respective sources of truth.
- Performing scheduler migration merely because a row is viewed or edited.

## 4. Verified current baseline

This section describes source that exists on the inspected `xos` checkout. It is not a statement that the code is installed or live-tested. `xos/PLAN.md:616-631` explicitly distinguishes source state from installed state and marks most later stages as not live-tested.

### 4.1 Separate surfaces today

- `src/renderer/src/components/automations/AutomationsPage.tsx:8-38` switches between the custom XOS Goals/Org view and the upstream automation list. They are alternative page bodies, not one list.
- `src/renderer/src/components/automations/automation-list-view.ts:21-42` defines only local and external rows. `automation-list-view.ts:117-152` flattens those two source types.
- `src/renderer/src/components/automations/AutomationsListPanel.tsx:335-359` has a local/external render switch.
- `src/renderer/src/components/automations/AutomationListTableHeader.tsx:18-52` currently shows Name, Schedule, Project, Host, Next, Last, Status, and Agent.
- `src/renderer/src/components/automations/AutomationListFilterMenu.tsx:179-217,237-357` filters host, status, last run, and agent. It has no Goal/Script type filter.

### 4.2 Native automation capabilities

- Native definitions already persist an execution target, generation pin, scheduler owner, workspace mode, timezone, RRULE, DTSTART, missed-run policy, agent, and source context: `src/shared/automations-types.ts:96-139`.
- Native runs already persist authority-relevant context, trigger, chat/terminal links, output snapshots, precheck results, usage, errors, and stable run numbers: `src/shared/automations-types.ts:141-175`.
- The editor already exposes destination, project/workspace, session, schedule, grace, precheck, and setup controls: `src/renderer/src/components/automations/AutomationEditorSettingsSidebar.tsx:105-193`.
- Local list rows already offer run, edit, pause/resume, and delete actions: `src/renderer/src/components/automations/AutomationListLocalRow.tsx:168-223`.
- The native runs table is a useful shell for normalized run rows: `src/renderer/src/components/automations/AutomationRunsTable.tsx:17-158`.

### 4.3 Goal capabilities that must survive

- The public Goal board model includes projects, goals, scripts, cron jobs, status, viewer data, and recent run receipts: `src/shared/xos-goals-types.ts:117-210`.
- The current Goal shape stores raw STATUS fields, card result/detail, schedule pause, `viewer.contractStatus`, and `viewer.latestRun` separately, while archived Goals are a separate source collection: `src/shared/xos-goals-types.ts:117-184`. However, `src/main/xos/xos-goal-entry.ts:183-187` can fall back from contract status to latest run status. The unified adapter must not carry that fallback into an ambiguous combined list status.
- `src/renderer/src/components/xos-goals/XosGoalViewer.tsx:107-193` provides run/reply, pause, file opening, recent runs, and live-tail access.
- `src/renderer/src/components/xos-goals/XosGoalRunList.tsx:11-71` shows Goal receipt details and Continue on… actions.
- `src/renderer/src/components/xos-goals/XosLiveRunTail.tsx:13-58,85-153` polls and renders native Goal run state, claimed work, and logs.
- Goal CRUD is implemented separately in `src/renderer/src/components/xos-goals/XosProjectManage.tsx:14-145`.
- Current Goal creation uses a hard-coded plain agent select: `src/renderer/src/components/xos-goals/XosNewGoalDialog.tsx:25-27,124-155`.
- Current legacy schedule management exposes cron/runner fields rather than the native automation editor: `src/renderer/src/components/xos-goals/XosGoalManage.tsx:88-131` and `XosCronJobDialog.tsx:30-31,114-152`.
- `src/main/xos/xos-goal-board.ts:85-170` derives the board from Goal folders, receipts, native receipts, and crontab; `xos-goal-board.ts:46-51` intentionally skips remote repos.

### 4.4 Existing Goal/Script bindings and cutover guards

- XOS runtime config can bind one native automation to either a Goal or a Script: `src/shared/xos-runtime-types.ts:21-50`.
- `src/main/xos/xos-goal-schedule.ts:27-56` creates a disabled native automation and writes the binding; `xos-goal-schedule.ts:59-127` provides schedule/replace operations.
- Active legacy cron blocks bound Goal dispatch in `src/main/xos/xos-goal-automation.ts:25-59` and bound Script dispatch in `src/main/xos/xos-script-runs.ts:46-54`.
- Native chat-run stop now asks the structured session host to interrupt the provider turn and throws if cancellation is refused: `src/main/automations/automation-chat-run-cancel.ts:15-49`. The XOS run gate also rebuilds active native/script state from its journal on host registration: `src/main/xos/xos-run-state.ts:129-160`. These are usable primitives for the proposed drain gate, but the current migration flow does not yet provide the cross-source in-flight cutover/recovery protocol in Section 8.2.
- XOS runtime configuration is a separate `automation-runtime.json` keyed by native automation ID, not a replacement scheduler database: `src/main/xos/xos-runtime-store.ts:1-5,33-52,164-191`.
- Script migration currently matches `replacesCronCommand` by command text: `src/main/xos/xos-cron-migration.ts:36-49`. That is not a sufficient long-term stable source identity.

### 4.5 Exact selector reuse

- Reuse `src/renderer/src/components/agent/AgentCombobox.tsx`. Its trigger and searchable menu render `AgentIcon`: `AgentCombobox.tsx:246-310,325-380`.
- Reuse provider icon mapping from `src/renderer/src/lib/agent-catalog.tsx:42-121`; do not create a second logo table.
- The native automation editor already uses `AgentCombobox`: `src/renderer/src/components/automations/AutomationEditorSettingsSidebar.tsx:75-90`.
- `src/renderer/src/components/native-chat/NativeChatModelCombobox.tsx:19-110` provides a reusable searchable combobox presentation, but its current API is chat-specific and does not itself perform host-scoped discovery or persistence.
- `src/renderer/src/components/xos-goals/XosAutomationModelField.tsx:31-45,85-192` has the live XOS catalog, custom model ID, and reasoning-effort behavior. Generalize that behavior behind an adapter instead of replacing it with the static source-control picker.
- Local XOS model discovery currently uses the local structured-session host only: `src/main/xos/xos-model-catalog.ts:8-16`.

### 4.6 Script and run gaps

- Script bindings persist raw `command` and `cwd`: `src/shared/xos-runtime-types.ts:46-50`.
- `src/main/xos/xos-runtime-store.ts:92-104` only validates their types and non-empty command; it does not validate platform, path authority, executable provenance, or privileges.
- `src/main/xos/xos-script-runs.ts:56-79` executes `/bin/bash -lc` in the bound cwd. This is not a cross-platform runner contract.
- `xos-script-runs.ts:31-43` includes the log path in a failure error but does not expose a durable success log artifact in the report.
- The public `XosGoalRun` lacks a run ID (`src/shared/xos-goals-types.ts:9-23`), while native Goal receipt production writes `run_id` (`src/main/xos/xos-goal-automation.ts:121-138`). A run adapter needs an explicit ID rather than a guessed timestamp/path join.
- External crontab IDs are hashes of schedule plus command: `src/main/automations/external-crontab-jobs.ts:44-46,117-159`. A schedule edit therefore changes this source ID.

## 5. Shared UX

### 5.1 Information architecture

Keep one Automations navigation destination. Within it, retain the existing high-value views and add the common list as the primary operational view:

- **List**: Goals, native automations, Scripts, and external jobs in one table.
- **Org**: the existing Goal organization chart.
- **Pipeline**: existing Goal/queue flow.
- **Runs**: normalized execution history.
- **Analytics**: existing XOS analytics.

The Tasks → Goals source remains the work-item view; it is not absorbed into the automation list.

Use the existing shadcn primitives and `docs/STYLEGUIDE.md`: idle rows remain transparent, hover/current states use `accent`, status color is semantic only, icons use the existing catalog/lucide, and all trust/run/delete dialogs use the security surface where required.

### 5.2 Shared list

Every row has a leading type glyph and label, then native-styled columns with type-aware values. Lifecycle, scheduling, and execution outcome are separate concepts; do not collapse them into one ambiguous “Status” value:

| Column          | Goal                                                                     | Native automation                        | Script                              | External job                          |
| --------------- | ------------------------------------------------------------------------ | ---------------------------------------- | ----------------------------------- | ------------------------------------- |
| Name            | Goal title/name                                                          | Definition name                          | Parsed or operator name             | Manager-provided name                 |
| Type            | Goal                                                                     | Automation                               | Script                              | External                              |
| Schedule        | One summary plus “+N” children                                           | RRULE summary                            | Native RRULE or legacy cron         | Native manager text                   |
| Project         | Goal project                                                             | Run-context project                      | Bound project/cwd owner             | External scope if known               |
| Host            | Actual authority                                                         | Execution target                         | Execution authority                 | Manager authority                     |
| Lifecycle/stage | Explicit Goal contract/lifecycle stage plus active/archived source state | Definition present/deleted as applicable | Definition/adoption state           | Manager-defined lifecycle if supplied |
| Schedule state  | Enabled/paused/mixed/unscheduled                                         | Enabled/paused                           | Enabled/paused/mixed/unscheduled    | Manager-provided state                |
| Next            | Earliest eligible schedule child                                         | Existing value                           | Bound or external evidence          | Existing value                        |
| Latest run      | Outcome and time, independently of lifecycle/schedule                    | Existing run outcome                     | Script run outcome                  | Manager run outcome                   |
| Agent           | `AgentIcon` and agent, if agent-driven                                   | `AgentIcon` and agent                    | “Shell”/runner, not a fake provider | Manager/provider                      |

Active unscheduled Goals remain visible by default with an `Unscheduled` schedule state; an empty schedule is not an error or a paused schedule. Archived Goals are excluded from the default active view but remain discoverable through a Lifecycle filter and direct links. Archived rows preserve their Goal files and metadata, expose only safe lifecycle/detail actions, and never acquire a synthetic enabled schedule. A Goal stage comes from explicit Goal metadata/STATUS fields; when it is absent, show `Unknown` rather than borrowing the latest run result. Completed and archived are Goal lifecycle states, not run outcomes.

Filters:

- type: Goal, Automation, Script, External;
- project;
- execution host/authority;
- schedule owner: Orca, legacy cron, external manager;
- lifecycle/stage: explicit Goal stage plus active/archived source state where supported;
- schedule state: enabled, paused, mixed, unscheduled;
- latest run outcome: running, succeeded, failed, limited, skipped, timed out, cancelled, no runs;
- agent/provider, only for agent-driven rows;
- migration state: legacy, paired, ready to cut over, migrated, conflict.

Search indexes display name, Goal slug, project, source ID, command basename, and manager name. Raw commands and secret-bearing arguments must not be placed into renderer telemetry or searchable analytics.

Row actions are type-specific. Do not render disabled native actions that do not make sense for an external job. The overflow menu can include:

- Goal: Run, Reply, Continue on…, open Goal, pause/resume at the correct owner, manage schedules, open files.
- Automation: existing run/edit/pause/delete actions.
- Script: review definition, run after confirmation, cancel when supported, manage schedule, open logs.
- External: existing manager actions only; otherwise show a read-only explanation.

### 5.3 Detail/editor shell

Use one shell for title, type/source badges, project, host, lifecycle/stage, schedule state and summary, latest run, recent runs, and primary actions. Keep those state fields separate. Render adapters inside it:

- `GoalDetailAdapter` embeds or composes the existing Goal Viewer sections. Do not flatten Goal contract, STATUS, org, inbox, queues, galleries, or live-tail features into generic fields.
- `AutomationDetailAdapter` uses the native definition, editor, and run history.
- `ScriptDetailAdapter` shows reviewed command, cwd, platform, environment policy, timeout, cancellation support, schedule ownership, and artifacts.
- `ExternalDetailAdapter` uses manager-provided metadata and capabilities.

“Create” opens a type choice: Agent automation, Goal, or Script. The following editor frame can be shared—name, project, host, schedule, and enabled state—but Goal lifecycle and all other fields/validation remain type-specific. External records are discovered, not created from this menu.

## 6. Agent and model controls

### 6.1 Agent selector

Use `AgentCombobox` directly for native automation and Goal agent selection. If the current component assumes a single global catalog, extend its input contract to accept the allowed agent rows for the selected authority while retaining its existing search, trigger, `AgentIcon`, and keyboard behavior. Do not fork the component into an XOS copy.

The selected execution host is chosen before agent/model options. Changing host revalidates both values and requires explicit confirmation if the current agent/model is unavailable; never silently substitute a provider.

Scripts show a runner/platform field, not `AgentCombobox`, unless a future Script type actually invokes an agent.

### 6.2 Model selector adapter

Extract the presentation contract of `NativeChatModelCombobox` into a reusable searchable model combobox. Supply it through a domain adapter:

```ts
type ModelPickerAdapter = {
  authority: ExecutionAuthority
  agentId: TuiAgent
  list(): Promise<ModelOption[]>
  validate(modelId: string): Promise<ModelValidation>
  allowCustomId: boolean
  effortOptions(modelId: string): readonly string[]
}
```

For XOS/Goal automations, the adapter should reuse the catalog, custom-ID, and effort rules currently in `XosAutomationModelField`. For other native automations, persistence continues through the native definition/launch setup mechanism until a first-class model field is deliberately added.

Provider icon comes from the selected agent via `AgentIcon`; models do not invent a second provider-logo mapping.

### 6.3 Host and credentials boundary

- Catalog requests are addressed to the selected execution authority, not always the local structured-session host.
- The response contains sanitized capability/model metadata only. It does not contain tokens, account files, auth headers, or credential paths.
- Validation and dispatch happen on the same authority that supplied the catalog.
- A disconnected/unsupported remote host shows “catalog unavailable on this host” and preserves the stored value without claiming it is valid.
- Current Goals remain explicitly local-only until a remote Goal file/runtime API exists. The common UI must label this constraint rather than routing local paths over SSH by inference.
- Authority includes the existing generation pin where available so a removed/re-added SSH target is not silently treated as the same credential boundary.

## 7. Canonical ownership and derived row model

### 7.1 Sources of truth

| Record                         | Authoritative source                       | Unified surface behavior                                 |
| ------------------------------ | ------------------------------------------ | -------------------------------------------------------- |
| Native definition/schedule     | Native automation store on scheduler owner | Read directly; edit through native API                   |
| Native run                     | Native automation run store                | Adapt; link to chat/terminal/output                      |
| Goal definition/state          | Goal folder/project home                   | Adapt; preserve Goal viewer/actions                      |
| Goal legacy schedules          | Crontab plus paused/adoption metadata      | Show as schedule children; edit through guarded cron API |
| Goal native binding            | XOS runtime binding keyed by automation ID | Fold bound automation into Goal row                      |
| Script native binding          | XOS runtime binding keyed by automation ID | Fold bound automation into Script row                    |
| External job                   | External manager response                  | Read/adapt; capabilities come from manager               |
| XOS attempt/fallback telemetry | XOS JSONL ledger                           | Join as supplemental run detail                          |

Do not persist `UnifiedAutomationRow`. Build it per request from source snapshots. Cache only as existing APIs already cache source data; invalidation uses source version/hash/updated-at values.

### 7.2 Proposed read model

```ts
type UnifiedAutomationKind = 'goal' | 'automation' | 'script' | 'external'

type UnifiedAutomationKey =
  | { kind: 'goal'; authority: AuthorityKey; projectKey: string; goal: string }
  | { kind: 'automation'; authority: AuthorityKey; automationId: string }
  | { kind: 'script'; authority: AuthorityKey; source: ScriptSourceKey }
  | { kind: 'external'; authority: AuthorityKey; managerId: string; jobId: string }

type UnifiedAutomationRow = {
  key: string
  kind: UnifiedAutomationKind
  sourceRefs: SourceRef[]
  capabilities: UnifiedCapabilities
  scheduleChildren: UnifiedScheduleRef[]
  lifecycle: UnifiedLifecycle
  scheduleState: UnifiedScheduleState
  runSummary: UnifiedRunSummary | null
  presentation: UnifiedPresentation
}
```

`key` is a versioned encoding of the typed identity, for example `u1:<authority>:goal:<project-key>:<goal-slug>`. It is for UI routing/selection, not a new domain ID.

### 7.3 Authority and stable identity

- Native automation: scheduler authority + `automation.id`. Include existing execution target generation as a source reference, not a replacement for scheduler ownership.
- Goal: Goal storage authority + canonical project key + exact Goal slug/name from the source. Do not dedupe by display title.
- External: authority + external `managerId` + `jobId`.
- Legacy cron: the current `cron-<hash>` value is only a source-scoped fingerprint of schedule plus command. It changes when either field is edited and identical duplicate lines produce the same value. Never call it a durable record ID. Scope every reference by execution authority, crontab owner/scope, and the exact source revision/hash. Within one immutable revision, add an occurrence discriminator supplied by the parser so duplicate lines are individually reviewable. Mutation requires the same revision and occurrence to still exist. Cross-revision continuity comes only from an explicit unique adoption/migration linkage stored beside the source or in guarded adoption metadata.
- Script: introduce a durable script source key before full migration. For an adopted cron line it should record authority, manager/scope, exact source revision/occurrence, a unique adoption ID, and replacement lineage. Command text and the current cron fingerprint are evidence, not identity.
- Run: authority + source kind + source run ID. Extend Goal receipt adaptation to carry `run_id`; do not synthesize a permanent ID from timestamp/log path except as a clearly marked legacy fallback.

### 7.4 Folding and deduplication rules

Apply deterministic precedence:

1. Read each source snapshot independently.
2. Build Goal and Script source rows first.
3. If a native automation has an exact Goal binding, attach it as a schedule/execution source to that Goal row and suppress its standalone row.
4. If a native automation has an exact Script binding, attach it to that Script row and suppress its standalone row.
5. Attach a legacy cron only through an exact Goal association or persisted adoption reference scoped to source host/owner. A command-name guess may produce a “possible match” review warning but must not fold rows or enable migration. A current hash match alone is insufficient when duplicate occurrences exist.
6. Leave unbound native automations as native rows.
7. Leave unclaimed external jobs as external rows.
8. Never dedupe solely by name, prompt, command, cwd, schedule text, or timestamps.

When sources conflict, render both or render one row with a conflict state and every source reference. Never silently discard one execution source.

## 8. Schedule semantics and migration

### 8.1 Display/edit semantics

A Goal can have multiple cron entries. A native automation currently has one RRULE/timezone schedule, and current Goal binding code prevents treating multiple native definitions as one Goal without further schema work. Therefore:

- the Goal row owns a collection of schedule children;
- each child carries `owner`, `format`, raw expression, timezone semantics, enabled state, next run, and source reference;
- cron remains cron in the editor; RRULE remains RRULE;
- no automatic lossy conversion is permitted;
- legacy crontab without an explicit timezone displays “host/crontab timezone,” not a guessed IANA timezone;
- macros such as `@reboot` stay manager-owned and are not offered for native conversion unless the native scheduler has equivalent semantics;
- until multiple bound native schedules are designed, migration UI must refuse a one-click “migrate all” for a Goal with more than one schedule.
- unscheduled Goals remain first-class rows and are never auto-archived or auto-paused;
- archived Goal files and metadata remain untouched; restoring or deleting an archived Goal uses the existing lifecycle API, not schedule controls.

### 8.2 Reviewed cutover

Migration is an explicit flow separate from ordinary edit:

1. Snapshot the source record, source host/owner, crontab hash/version, occurrence discriminator, adoption metadata, scheduler authority, and target capabilities. If identical duplicate lines cannot be distinguished in the current parser/API, migration of either duplicate is blocked until an occurrence-aware guarded mutation API exists.
2. Show source and proposed target side by side: schedule/timezone, host, cwd/workspace, agent/model, precheck, timeout, environment, missed-run behavior, logs, and known semantic differences.
3. Create the native replacement disabled and idempotently.
4. Persist a unique migration/adoption ID and exact binding/replacement lineage. Do not use fuzzy command matching or the schedule-plus-command fingerprint as continuity across revisions.
5. Re-read both source and target; abort on changed source hash, changed target generation, missing binding, or duplicate/conflict.
6. Disable/pause the legacy source through its guarded API.
7. Re-read and confirm the source schedule is inactive. Schedule state alone is insufficient: disabling a schedule does not stop an already running process.
8. Query the execution host for authoritative in-flight source and target runs. The initial implementation uses a drain-and-confirm gate: wait for each source run to finish, or explicitly cancel it and wait for confirmed termination, before enabling the replacement. A later implementation may substitute one shared idempotency/lease mechanism that spans both dispatch paths, but must not rely on separate best-effort locks.
9. If run state is unknown, the execution host is disconnected, cancellation is unconfirmed, or a new source run appears, pause cutover with both schedules in their current state and require a fresh re-read. Do not infer that no process exists from a disabled schedule or a missing renderer session.
10. Enable the native replacement only after the drain gate or shared lease is authoritative.
11. Re-read source schedule, target schedule, binding, and host run state; then persist the confirmed cutover state and display it.

The existing active-cron dispatch guards remain mandatory defense in depth. They are not a substitute for the re-read gates. Because writes span sources, call this a guarded sequence, not an atomic transaction.

For rollback, disable the native automation first, confirm the target schedule is inactive, and query the host for authoritative target runs. Drain or explicitly cancel and confirm every target run before restoring the source. If execution state is unknown or the host disconnects, pause rollback with the source disabled. Restore/unpause the exact legacy source only against the expected version/hash, then clear or mark the binding as rolled back after a final re-read. Never enable both as the normal rollback path.

On startup or retry, derive an explicit recovery state from fresh source, target, binding, and host-run evidence:

- **Both disabled:** safe paused state; keep both disabled until the operator resumes cutover or rollback after validation.
- **Source active, target disabled:** pre-cutover/source-authoritative state; do not enable the target automatically.
- **Target active, source disabled:** post-cutover/target-authoritative state; preserve the target and verify/repair metadata without re-enabling the source.
- **Both active:** unsafe conflict; never recover automatically to either side. Block further migration actions, surface both sources and in-flight evidence, and require an explicit guarded operator choice.
- **Execution state unknown or host disconnected:** indeterminate state; do not enable either side or claim recovery until the authority can be queried.

Recovery must be idempotent. A process restart at any cross-store boundary may repeat a verified write or re-read, but must never infer completion from the last attempted step.

## 9. Script execution boundary

Do not enable general Script creation or migration until a first-class runner contract exists.

Required definition fields:

- durable script ID and source lineage;
- execution authority and supported platform;
- executable/runner kind plus arguments represented separately where possible;
- reviewed command preview when shell syntax is unavoidable;
- canonical cwd tied to an allowed project/workspace or explicit approved path;
- environment-variable allowlist/reference policy, with secret values resolved only on the host;
- timeout and termination grace;
- cancellation capability;
- log/stdout/stderr artifact policy and size/retention bounds;
- concurrency/overlap policy;
- network and filesystem privilege description.

Safety rules:

- No hidden `/bin/bash -lc` assumption. Implement platform-specific runners using the repository process wrappers and runtime guards documented in `docs/agents-md-refs/cross-platform-support.md`.
- Start with the platforms actually supported by the runner. Unsupported targets are read-only and say why.
- Validate cwd on the execution host immediately before spawn; reject missing paths, disallowed roots, or changed authority.
- Avoid `shell: true` as the default. If a migrated legacy command requires a shell, show the exact shell and command in a security-surface review and persist that choice explicitly.
- Do not copy the parent app environment wholesale. Resolve only approved variables/secrets on the host.
- Run with the Orca user unless a separately designed privilege broker exists; never infer elevation from legacy text.
- Enforce timeout in the host process supervisor and terminate the process tree using existing cross-platform process abstractions.
- Cancellation is capability-based. The UI must not show “Cancelled” until the host confirms termination.
- Capture bounded artifacts on success and failure, scrub configured secret patterns at source, and record truncation.
- Require the same disabled-replacement and duplicate-execution gates used for Goal cutover.

## 10. Unified runs and artifacts

Define a renderer-facing adapter, not a copied run store:

```ts
type UnifiedRunRef = {
  key: string
  ownerKey: string
  source: 'native' | 'goal-receipt' | 'xos-ledger' | 'external'
  sourceId: string | null
  status: UnifiedRunStatus
  trigger: string
  scheduledFor: string | null
  startedAt: string | null
  finishedAt: string | null
  usage: UnifiedUsage | null
  artifacts: UnifiedArtifactRef[]
  links: UnifiedRunLinks
}
```

Adapters:

- Native: preserve native run ID, chat/terminal links, output snapshot, precheck, usage, and error.
- Goal receipt: carry `run_id`, runner/model/effort, log path, failure reason, trigger, duration, and Continue on… capability.
- XOS ledger: join supplemental attempts/fallbacks/commits only by exact native run identity plus authority.
- Script: persist a first-class run report with exit status, stdout/stderr/log artifact on success and failure, timeout/cancel reason, and process termination result.
- External: preserve manager/provider/job/run IDs and only capabilities supported by that manager.

Status mapping must retain source status detail. For example, `limited` must not be displayed as ordinary success merely to fit the native enum. Unknown statuses render as source-specific labels and do not grant action capabilities.

Artifact paths are host-qualified references. Opening a remote artifact goes through a host-aware API; never treat it as a local renderer filesystem path.

## 11. API and implementation phases

The roadmap has seven numbered phases, Phase 0 through Phase 6. Phases 0–5 deliver the requested local unified surface and safe local cutover path. Phase 6 is deferred follow-on work and is not a prerequisite for the local surface.

### Phase 0 — contracts and fixtures

1. Add shared read-model types in a concretely named module such as `src/shared/unified-automation-types.ts`.
2. Add authority-key encoding/decoding and source-ref validation with unit tests.
3. Add pure adapters for native definitions, external jobs, Goals, legacy cron children, bindings, and run records.
4. Add deterministic fold/conflict logic. No persistence.
5. Add representative fixtures: multiple cron schedules, bound Goal, bound Script, name collision, edited cron ID, remote native automation, disconnected host, and legacy receipt without `run_id`.

### Phase 1 — minimum first deliverable: read-only shared list

1. Add a main-process aggregation endpoint that snapshots existing local source APIs and returns the derived list plus source revisions/warnings.
2. Extend the list row union/rendering to the derived `kind` adapters rather than adding ad hoc branches throughout the panel.
3. Add Type, Project, Owner, and Migration filters while preserving current host/status/agent filters.
4. Use `AgentIcon` for agent-driven rows.
5. Open existing Goal Viewer, native detail, or external detail from each row; Script opens a read-only review panel.
6. Keep current Org/List switch available and put the new list behind `unifiedAutomationSurface`.
7. No create, migration, or new execution path in this phase.

Likely affected paths:

- `src/renderer/src/components/automations/AutomationsPage.tsx`
- `src/renderer/src/components/automations/automation-list-view.ts`
- `src/renderer/src/components/automations/AutomationsListPanel.tsx`
- `src/renderer/src/components/automations/AutomationListTableHeader.tsx`
- `src/renderer/src/components/automations/AutomationListFilterMenu.tsx`
- row components under `src/renderer/src/components/automations/`
- Goal adapters under `src/renderer/src/components/xos-goals/`
- IPC/preload contracts adjacent to existing automations and `xosGoals` APIs

### Phase 2 — shared detail and run adapters

1. Add the detail shell and capability contract.
2. Compose existing Goal Viewer sections; do not rewrite them.
3. Add normalized runs with exact source links and host-qualified artifacts.
4. Extend native Goal receipts to expose `run_id` end to end.
5. Add first-class Script success/failure artifacts before showing Script execution history as complete.

### Phase 3 — native selectors and type-aware editor shell

1. Replace hard-coded Goal agent selects with `AgentCombobox`.
2. Extract a reusable model-combobox presentation and connect the XOS model adapter.
3. Add authority-scoped catalog APIs and unavailable-host states.
4. Add Create → Agent automation / Goal / Script shell, but keep Script creation gated until Phase 5.
5. Preserve current native automation persistence semantics; do not hide model settings in unstructured args without an explicit compatibility design.

### Phase 4 — Goal schedule management and migration

1. Present legacy and native schedule children together.
2. Keep current guarded cron CRUD for legacy edits.
3. Add the reviewed disabled-replacement flow for eligible single schedules.
4. Add durable adoption lineage and conflict recovery.
5. Design and implement multi-schedule native bindings before permitting complete migration of Goals with multiple cron entries.

### Phase 5 — safe Script runner and migration

1. Introduce the script definition/run schema and host runner described in Section 9.
2. Implement per-platform capability reporting.
3. Add explicit security review for command/cwd/environment.
4. Add timeout, cancellation, process-tree cleanup, bounded artifacts, and retention.
5. Replace command-only migration matching with durable source lineage.
6. Enable Script create/run/migrate only on supported targets.

### Phase 6 — deferred remote Goal and expanded mobile parity

1. Add owner-scoped Goal storage/runtime APIs before enabling remote Goal rows as actionable.
2. Keep list/detail useful at mobile sizes; move secondary columns into the row detail rather than horizontal overflow.
3. Verify all authority-aware actions under SSH latency and disconnection.

Remote native automations are existing functionality, not deferred Goal work. Every earlier phase must preserve their current listing, detail, scheduling, and run behavior even while Goal aggregation remains local-only. Phase 6 concerns remote Goal storage/execution and expanded mobile parity only.

## 12. Acceptance criteria

### Shared list

- A bound native Goal automation appears once as a Goal row with native and legacy sources visible.
- A bound Script automation appears once as a Script row.
- An unbound native automation and unclaimed external job remain separate rows even when their names match a Goal.
- A Goal with three cron entries shows three schedule children and is not collapsed to one RRULE.
- Goal lifecycle, schedule state, and latest run outcome are independently visible and filterable.
- Active unscheduled Goals appear in the default list as Unscheduled; archived Goals are excluded by default but appear under the Archived lifecycle filter without losing files or metadata.
- Filters and search return deterministic results after refresh and source reordering.
- Selection survives ordinary refresh by unified key; when a cron edit changes its fingerprint, explicit replacement lineage restores the intended detail or the UI shows a precise stale-selection message. It never follows a fuzzy command match.
- Provider logos are rendered by `AgentIcon`; the UI has no duplicate icon map.
- Existing Org, Pipeline, Analytics, Tasks → Goals, Goal Viewer, and native list workflows remain reachable.

### Authority and credentials

- Agent/model options come from the selected execution authority.
- Changing authority invalidates unsupported choices and never silently substitutes them.
- No API response or renderer state contains provider credentials or secret values.
- A disconnected host preserves stored labels, disables unsafe actions, and does not claim validation.
- Remote native automations remain usable; local-only Goals are labeled accurately.

### Scheduling and migration

- Cron and RRULE/timezone values round-trip in their own source formats.
- Migration creates a disabled replacement first and refuses on stale source host/revision/occurrence, indistinguishable duplicate lines, changed target generation, conflicts, or multiple schedules without an approved mapping.
- Disabling a schedule never counts as proof that no process is running; replacement enablement requires host-authoritative drain confirmation or one shared cross-dispatch idempotency/lease mechanism.
- Unknown/disconnected execution state pauses cutover or rollback without enabling the other schedule.
- At no point in a successful cutover do both legacy and replacement schedules remain intentionally active.
- Existing active-cron dispatch guards still prevent duplicate Goal/Script execution.
- Rollback restores the exact source or stops with an actionable conflict; it never overwrites unrelated crontab edits.
- Restart recovery distinguishes both-disabled, source-active/target-disabled, target-active/source-disabled, both-active, and indeterminate states. Both-active recovery always requires an explicit guarded operator decision.

### Scripts

- Unsupported platforms/hosts are read-only.
- The operator reviews command, shell/runner, cwd, environment policy, authority, timeout, and replacement source before enablement.
- Cwd and authority are revalidated on the host at dispatch.
- Timeout and cancel terminate the intended process tree and report confirmed final state.
- Success, failure, timeout, and cancellation all produce bounded, openable artifact references.
- Secret values are not copied into renderer state or normal logs.

### Runs

- Native, Goal, Script, and external runs have authority-qualified keys and link to the authoritative record/artifact.
- XOS attempts/fallbacks join only to the exact native run.
- `limited`, skipped/precheck, timeout, cancellation, and dispatch failure remain distinguishable.
- Legacy Goal receipts without IDs are marked as legacy identity and do not collide silently.

## 13. Verification plan

Follow repository test guidance: test production adapters and APIs, not mock-only reimplementations; use `--maxWorkers=2`; run scoped checks during development and `pnpm check:changed` immediately before any eventual push.

### Unit tests

- Authority-key encoding, generation pinning, and route round-trip.
- Folding precedence and collision cases across all four row kinds.
- Exact binding joins versus possible command/name matches.
- Multi-cron schedule aggregation, macros, paused entries, and timezone labels.
- Cron edit replacement lineage and stale-selection behavior.
- Identical duplicate cron lines, occurrence discrimination within a fixed revision, and refusal when exact targeting is unavailable.
- Independent Goal lifecycle, schedule-state, and latest-run aggregation, including unscheduled and archived Goals.
- Run ID mapping, legacy fallback identity, status preservation, and artifact qualification.
- Host-scoped agent/model validation and custom-model behavior.
- Script cwd/platform/environment validation and timeout/cancel result mapping.

### Integration tests

- Aggregate real source fixtures through the main-process endpoint and renderer store.
- Source changes between snapshot and action produce a conflict rather than an overwrite.
- Disabled replacement, legacy pause, confirmation, enablement, and rollback sequence.
- Host-authoritative in-flight detection proves that disabling a schedule does not enable its replacement while an earlier run is still active.
- Drain completion, confirmed cancellation, host disconnection, unknown process state, and a source run appearing during cutover.
- Crash/restart at every cross-store boundary: disabled target creation, binding/lineage persistence, source disable, source-state re-read, drain confirmation or lease acquisition, target enable, confirmed-state persistence, target disable during rollback, target drain, source restore, and rollback-state persistence.
- Recovery fixtures for both-disabled, source-active/target-disabled, target-active/source-disabled, both-active, and indeterminate states. Recovery must be idempotent, must never automatically recover a both-active conflict, and must never enable a side from stale last-attempted-step data.
- Active-cron duplicate guards for Goal and Script bindings.
- Remote host disconnect/reconnect and generation replacement.
- Existing remote native automation list, detail, schedule, and run behavior across every local-unification feature flag state.
- Script process tree termination on each supported platform using existing process wrappers.
- Folder workspaces and non-git Goal projects.

### Rendered UI tests

- Component fixture screenshots at reproducible viewport/state for list rows, filters, details, empty/error/conflict states, and light/dark mode.
- Keyboard navigation and accessible names for type chooser, filters, AgentCombobox, model combobox, menus, and dialogs.
- Provider icon and selected-agent rendering in compact rows.
- Multiple schedule children, source badges, migration review, and script security review.
- Responsive/mobile layout without hiding source ownership or destructive consequences.
- Hidden Electron/CDP validation with `ORCA_BACKGROUND_LAUNCH=1`; never steal focus or use computer-use for Orca validation.

### Regression tests

- Existing native create/edit/run/pause/delete and run history.
- Existing external manager rows/actions.
- Goal Org, Pipeline, Analytics, Viewer, reply, live tail, files, lifecycle, and guarded cron CRUD.
- Model/fallback editor behavior.
- macOS, Linux, Windows rendering and supported execution behavior; explicit unsupported states where execution is not yet portable.

## 14. Rollout and rollback

Feature flags:

- `unifiedAutomationSurface`: derived list/detail navigation only.
- `unifiedAutomationEditors`: shared selector/editor shell.
- `goalScheduleMigration`: reviewed Goal cutover.
- `scriptAutomationRunner`: Script creation/execution/migration.

Flags must be independently disableable. A flag changes reachability, not stored definitions. Turning off the shared surface returns to the existing native list and XOS Goal views because no unified list has been persisted.

Roll out in order: developer fixtures/tests, local read-only opt-in, local editor opt-in, eligible single-schedule Goal migration, safe Script pilot, then remote/mobile expansion. Collect only non-secret operational metrics: source counts by kind, conflicts, adapter failures, action result codes, migration step failures, and rollback use.

Rollback of UI phases is a flag change. Rollback of a scheduler migration follows the source-specific guarded sequence in Section 8.2 and must be tested before the migration flag is enabled.

## 15. Risks and unresolved decisions

1. **Multiple Goal schedules:** decide whether the native model becomes one automation per schedule with a Goal-level binding collection, or gains a schedule collection. Do not ship full migration until one representation preserves independent enable/pause and run provenance.
2. **Script identity:** define durable adoption lineage that survives a cron schedule edit without relying on command text.
3. **Remote Goals:** choose where Goal folders and XOS runtime config live per authority and how they are addressed. Current board discovery is intentionally local-only.
4. **Model persistence:** decide whether native definitions receive first-class model/effort fields or continue a compatibility mapping to launch args. The UI must not overstate structured persistence before that exists.
5. **Script contract:** decide supported platforms, shell-free argument representation, secret reference provider, environment allowlist, sandboxing availability, and network policy.
6. **Run retention:** align XOS ledger, Goal receipts, native runs, and Script artifacts without deleting authoritative history unexpectedly.
7. **External capabilities:** each manager needs a capability contract; do not infer edit/pause/run support from row shape.
8. **Page naming/default view:** decide whether the navigation label remains Automations or becomes Goals & Automations. This is presentation only and should not force a data migration.
9. **Source snapshot consistency:** aggregation spans stores; expose revisions and warnings so a partially unavailable source is not presented as an empty authoritative source.
10. **High-churn fork integration:** keep new logic in concrete adapter/read-model modules and minimize edits to upstream list primitives to reduce rebase cost.

## 16. Minimal executable milestone

Ship only the following first:

1. Pure shared identity, adapter, and folding modules with fixtures.
2. One local aggregation API returning a non-persisted derived list.
3. Feature-flagged shared List view with Type/Project/Host/Owner filters.
4. `AgentIcon` in agent-driven rows.
5. Type-specific navigation to existing Goal Viewer, native detail, read-only Script review, and external detail.
6. Source badges, conflict warnings, and multiple schedule children.
7. No new create, edit, migrate, or execute behavior.

This milestone directly validates the desired one surface and one shared list while leaving current schedulers, credentials, scripts, and Goal-specific detail behavior untouched. It is reversible by disabling one flag and creates no new persisted duplicate state.
