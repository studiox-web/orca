# Coordinated development workflow

Status: working guidance for local development. This document does not start a builder, schedule work, authorize a provider change, or expand an assignment's scope.

Use this alongside [AGENTS.md](../AGENTS.md), [CONTRIBUTING.md](../.github/CONTRIBUTING.md), and the installed Orca CLI's version-matched orchestration guide. Repository requirements and the user's current authorization take precedence.

## Keep ideas, active work, and completed behavior separate

DJVibe and Cascade use `docs/features/planned/`, `in-progress/`, and `completed/`, with explicit readiness, blockers, and acceptance criteria. Mirror that distinction when organizing Orca work, while preserving an existing feature's established document location. The current coordinator feature remains in [its design and implementation brief](design/outcome-coordinator-exploration.md); this guide does not move it or install the other projects' Feature Builder.

| State           | What the document must say                                                                                                                                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Idea / deferred | Problem, observed evidence, proposed improvement, and what must be decided before implementation. Keep broad roadmaps out of an executable build queue.                                                                           |
| Planned         | A bounded outcome, dependencies, allowed files/effects, acceptance checks, and explicit blockers. When using the sibling projects' metadata format, keep `builder.ready: false` until the scope is actually ready and authorized. |
| In progress     | Current owner and exact Run/Task/Dispatch, source revision, unfinished work, evidence, and next step. A stopped turn or quota wait is not completion.                                                                             |
| Completed       | Implemented behavior, exact verification evidence, known limitations, and whether it is only local source, installed, or deployed. Do not imply deployment from a passing test or commit.                                         |

Creating a file or setting readiness metadata is not authority to dispatch workers, publish, deploy, or change schedules. Reuse a repository's actual intake mechanism when one exists; do not invent a second backlog service.

## Plan coherent build batches

1. State the finished user outcome and a small acceptance checklist before assigning code. Separate the current milestone from later pilots and improvements.
2. Check prerequisites early: required skills, runtime and package-manager versions, test method, fixtures, provider support, and safe app launch policy. For Orca, use Node 24 and the pinned pnpm version; the current workstation requires pnpm 12.14.0.
3. Give each worker one coherent chunk and one explicit file-ownership area. Parallelize independent areas; serialize shared-contract changes and other single-writer work. Reuse authorized workspaces and preserve unrelated dirty files.
4. Agree on a compatible backend/UI contract packet, then let the dependent worker consume it once. Record dependency-only imports separately so integration does not duplicate them.
5. Include the target, exact identities, original permission boundaries, allowed files, acceptance evidence, and reporting requirements in each assignment. Use native Orca orchestration for requested Orca workers; read its current guide instead of guessing commands.
6. Integrate compatible local commits in dependency order. An integration commit records combined local source; it does not mean a remote merge, push, install, or deployment.

Run focused tests while building. At the end of the coherent batch, perform combined verification and one independent review. Fix all supported blocking findings together and rerun affected checks. Add another broad pass only for changed code, a failure, or an unresolved concern. Known identity, approval, or duplicate-effect defects remain blockers throughout.

## Allocate provider capacity deliberately

- Keep the coordinator and worker assignments explicit. Record the requested provider/model and, where supported, the effective model observed at launch or in execution receipts.
- Distinguish installed CLI support, authentication, user-reported credits, measured remaining allowance, and a successful task start. None proves all the others.
- Account for shared allowance pools: additional workers or different model names do not necessarily provide additional quota. Prefer bounded independent work and reserve capacity for integration and review.
- Verify availability through supported read-only status before assigning work when possible. Do not spend credits on repeated speculative probes or launch attempts. If telemetry is unavailable, report capacity as unknown.
- A model or provider change must follow the current user selection and applicable authorization. Preserve the assignment and unfinished source; inspect or stop/fence the exact previous attempt as required before a replacement can own its files. Silence or quota exhaustion does not prove process exit.
- On denial, stop that operation and report the exact action, target, reason, work already completed, and whether the result was denied, pending, or uncertain. Do not purchase capacity, change accounts, bypass a restriction, or repeatedly retry. A user-authorized retry still requires reconciliation of any uncertain outcome first.

**Capacity note from the November 10 coordinator run:** Graham reports some Gemini allowance remains and expects Kimi to recover soon. Neither capacity nor a Kimi reset time was verified by this documentation task. Existing backend and renderer assignments remain Claude/Fable under the last explicit selection; this note is input for a later allocation decision, not an instruction to switch them.

## Handle quota waits and recovery without duplicate work

Read the current exact worker state and its latest quota/error evidence. Record a provider's reset time with its timezone and observation time; mark it as reported, not guaranteed. Keep terminal liveness, active model work, Task status, and semantic outcome separate.

If the provider already promises automatic continuation, preserve that session. At an authorized check, first establish whether it is already working or has completed. Do not send a second continuation, create a competing worker, or replay a possibly completed side effect. A one-time verification timer is separate from provider auto-resume and must not silently become a recurring schedule.

If a retry is authorized and the worker is still idle at a resolved boundary, use the native recovery path for the existing assignment, within the user's retry limit. If it is denied again, stop and report. Reconcile locks, current external state, receipts and exact attempt identity before any side-effect retry. Independent backups remain independent.

Use Orca wake messages rather than polling. Read a notified inbox message once, handle its whole batch, and retain its identity. After work is dispatched and there is nothing else to do, yield for the next notification.

## Write a durable handoff

Keep task-specific checkpoints with the active work, and reference them from the feature document when needed. Store no credentials or account secrets. A handoff should be sufficient for another authorized agent to continue without reconstructing the entire chat:

```text
Outcome and remaining acceptance criteria:
Run / Task / current Dispatch / predecessor relationship:
Workspace and file ownership:
Requested provider/model; observed effective model and evidence:
Committed revision; integrated revision; dependency-only commits:
Dirty and untracked source to preserve:
Checks: command, tested revision, exit result, artifact references:
Unrun checks and unresolved findings:
Current wait/error, observed time, reported reset and timezone:
Existing auto-resume or one-time verification arrangement:
Uncertain launches/writes, locks, receipts and required reconciliation:
Next bounded action and authorization limits:
```

Before the replacement edits, require an acknowledgement of the current handoff: exact Task/Dispatch, source revision, dirty-file inventory, critical shared contracts, scope and next action. Queue acceptance or a notification is not proof that the brief was consumed. If a stored Task prompt has historical provider instructions, explicitly supersede them with the latest user selection and deliver the current brief before implementation. Use native messaging and supported launch/attachment paths; do not steer a dispatched worker through its terminal.

The November 11 transfer exposed this distinction: Kimi had continued working while two supplemental Dispatch messages remained unhandled. Codex received the consolidated brief at launch and acknowledged it before edits. An external terminal also prevented Orca from proving a guarded stop; Graham exited the agent, its exact terminal showed exit plus a shell prompt, and only then was the old assignment fenced and replaced. Fencing alone would not have proved process exit. Current selection for this build is Codex for all remaining assignments; the November 10 capacity note above is historical.

Native `worker_done` settles a worker assignment; a progress note, input-accepted receipt, passing typecheck, or quota stop does not. The coordinator still validates the reported artifacts and acceptance criteria before declaring the parent outcome complete.

## Verify at the appropriate level

- Capture exact command and exit evidence for the tested revision. Do not add overlapping test counts or apply an older successful run to newer unfinished changes.
- Separate source/unit tests, component captures, the combined app journey, and installed behavior. Each answers a different question.
- When adding a main-process dependency, verify its packaged runtime closure and build the target artifact before handing it over for installation. The coordinator's AJV validator passed source and hidden-app checks, but the first XOS package failed because AJV was absent from `config/packaged-runtime-node-modules.cjs`; an isolated copied-package test now covers schema compilation without checkout dependencies.
- For Orca UI, follow AGENTS.md: `ORCA_BACKGROUND_LAUNCH=1`, required Electron skill and hidden-renderer Playwright/CDP checks, and no desktop-focus changes. Resolve a missing required method explicitly before launching; screenshots of components do not replace the app journey.
- Use focused checks with bounded workers during development. Before any separately authorized push, run the required final `check:changed` gate after the last edit/rebase; never bypass hooks.
- When integrating a long-lived feature into XOS, validate the complete delta against the actual destination branch early. HEAD-only or per-worker incremental quality checks can miss earlier styling, localization and type-rule violations. Run the combined gate after integration as well; preserve generated handoff evidence outside the tracked source selection.
- For documentation-only edits, formatting, link checks, and `git diff --check` are appropriate. Disclose that product tests were not run.

## Capture lessons without moving the finish line

After a meaningful batch, record the observation, supporting receipt/revision, practical consequence, and a proposed change. Apply better working practices immediately when already within scope; keep new product capabilities deferred until selected for implementation. This is a manual documentation practice, not a new retrospective automation.

The current run's [lessons and deferred upgrades](design/outcome-coordinator-exploration.md#lessons-and-deferred-upgrades) are the canonical feature backlog: quota visibility and safe continuation, durable handoff/model provenance, consolidated notifications, and scheduling around shared allowance. Keep their detailed acceptance criteria there instead of maintaining two competing copies.

## Reference patterns inspected

These are read-only examples from Graham's sibling projects, not changes or inherited operational authority:

- [DJVibe feature lifecycle](/home/djvibe/projects/djvibe.com/docs/features/README.md): planned/in-progress/completed, readiness metadata, blockers, bounded specs.
- [Cascade feature lifecycle](/home/djvibe/projects/CascadeWellness/docs/features/README.md): candidate versus build-ready work, acceptance criteria, and completed-behavior evidence.
- [Cascade QA lessons](/home/djvibe/projects/CascadeWellness/docs/qa/lessons-learned.md): durable lessons and evidence-backed failure handoffs.
