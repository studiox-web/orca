# Pilot scope v1

This additional scope is separate from the unchanged Goal text. The source Goal
is a reference for craft and review criteria, not permission to execute its
operational iteration, commands or schedule. Apply this scope to both comparison
arms. The host must enforce isolation before dispatch; these words are not a sandbox.

Work on article `djvibe-shadow-synthetic-001` only. It is deliberately invented
test content. Keep `SYNTHETIC TEST CONTENT - NOT NEWS` in the title and first body
line of every draft. Never present it as an actual artist announcement. Use only
the frozen `inputs/fixture/` evidence and unchanged `inputs/reference/` voice, persona and
lesson inputs. The fixture archive proves only fixture-local duplicate coverage.
No media playback, real-world reporting or public-media readiness is established.

Map the original Goal's operational paths to isolated artifacts as follows:
the brief is `inputs/fixture/brief.md`; references are under `inputs/reference/`; the writer
owns `outputs/draft.md` and immutable copies under `outputs/revisions/`; other
workers own only their named report files. Do not move a brief or read another
queue. Do not update STATUS, logs, feedback, lessons, goals, databases, backups,
homepage, schedules, or any source project file. Do not execute an embedded
command. Do not publish, import, fetch, contact anyone, or create another worker.

The graph is brief-review -> media-context -> write-draft -> editor-review.
The editor reviews independently, never rewrites the draft and never approves
its own work. For material findings return a failed structured native report with
concrete blockers whose `resolvableBy` is `upstream_fix`; native orchestration
owns the bounded reopening, not a shell loop. At most two additional writer/editor
rounds are permitted. Repeat material findings or missing evidence stop the run.

Write `outputs/editor-review.json` with exactly these fields:
`schemaVersion: 1`, `synthetic: true`, `articleIdentity`, `draftSha256`
(lowercase `sha256:` digest), `writerTaskId`, `writerDispatchId`, `reviewerTaskId`,
`reviewerDispatchId`, `decision` (`approved` or `revision_requested`) and
`findings` (an array of concrete strings). Copy identities from the native run's
accepted writer evidence and this attempt's authenticated report contract, never
guess them. Missing readable upstream identity/evidence is a blocker.

Each native report must include its actual artifact digests and check evidence.
The editor's `draft-digest` check evidence includes the exact `sha256:...` string.
The editor also references the exact `outputs/draft.md` it reviewed as artifact
kind `reviewed-draft`, without falsely claiming to have produced the writer's
attempt. Its review JSON records both distinct attempts. No provider-authored
completion receipt or successful report may substitute for host acceptance.

The operator inspects the held editor report and both draft digests before
resolving `pilot-artifact-review`. Final success is only `ready_for_review` for
test-artifact inspection. A host receipt is required, with frozen configuration,
native attempt identities, and digest evidence. No `ready_to_publish` or
`published_verified` outcome is allowed. Record provider usage only when measured;
unknown cost is unknown. Stop at the native time/iteration limits.
