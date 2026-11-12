---
id: content-loop-retrospective
type: goal
lock_lane: content
lock_wait_seconds: 1800
agents: [codex]
model: gpt-5.4-mini
model_reasoning_effort: medium
estimated_runtime: 30m per iteration
requires:
  - local repository checkout
  - content desk goal logs and content workspace
  - owner feedback records under content/feedback/incoming/
---

# Goal: Content Loop Retrospective

## Mission

Close the tuning loop for the DJVibe content desk. This is the mechanism that makes a reject or a tweak on one article make the *next* one better, automatically, without the owner re-explaining (plan §14.4). It does two things:

1. **Route owner feedback.** Read the Keep / Tweak / Reject records the owner leaves (in `content/feedback/incoming/`, written by the Command Centre control and by `djvibe:unpublish-post`) and fold each note into the exact place that changes future output: the byline persona's `## Lessons`, the writer/editor `LESSONS.md`, or rejected-topic memory.
2. **Run the weekly editorial-quality audit.** Compare recent automation articles with the synced external article corpus, look for recurring wordiness, stock phrasing, weak headlines, unearned structure, and missed artist-image opportunities, then fold one evidenced lesson back into the desk.
3. **Run the weekly process retro.** From recent desk evidence, find where the pipeline stalled and propose one narrow improvement.

It runs **weekly, plus an immediate pass whenever owner feedback lands**. The weekly pass includes the corpus audit; feedback-triggered passes stay narrow and do not rerun it unless the feedback exposes a house-wide pattern. It does not research, write, edit, publish, or promote articles.

## Definition of Done

Continuous. Only write `Definition of Done met` if the operator retires the content retrospective.

## Feedback record shape (what it reads)

Records arrive in `content/feedback/incoming/` with frontmatter like:

```yaml
action: keep | tweak | reject | edit
slug: <post slug>
post_id: <id>
byline: <persona username or null>
beat: <category slug>
reason: "<one-line summary>"
created: YYYY-MM-DD
source: command-centre | admin-edit | djvibe:unpublish-post
revision_id: <blog_post_revisions id, present on edit records>
```

The record **body** carries the full note. Tweak notes may contain pinned annotations (`Re: "<quoted passage>" → <comment>` blocks) — each one is targeted feedback about that exact passage. `edit` records carry a sentence-level diff of what the owner changed by hand.

## Routing rules (the important part)

For each incoming record, decide where the lesson belongs, then apply it and move the record on:

- **Tweak → rewrite request (owner decision 2026-07-22).** A `tweak` is not just a lesson for next time — the owner wants *this* article rewritten with the note incorporated. Find the source draft in `content/drafts/` whose `published_post_id` matches the record's `post_id` and reopen it: set `review_status: revision_requested`, add `revision_source: owner_tweak` and `owner_note: "<the record's reason>"` to its frontmatter. The writer handles it first-priority, the editor re-gates it, and the publisher republishes it in place (`djvibe:create-post --update` snapshots the old version to `blog_post_revisions` first, so the owner can roll back with `djvibe:rollback-post <slug>` if the rewrite lands worse). If no matching draft file exists (pre-loop posts), note it in the report instead. *Also* file the lesson per the rules below — the rewrite fixes this article, the lesson fixes the next one.
- **Craft / voice lesson, house-wide** (a recurring writing or editing miss) → append to `automations/goals/content-writer/LESSONS.md` or `automations/goals/content-editor/LESSONS.md`. If it is a genuine house-voice change, do **not** edit `SOUL.md` directly — write a proposal under `inbox/` (SOUL.md is a binding contract; changes go through the owner).
- **Topic lesson** (a subject that got pulled or that keeps missing) → record it in `content/ideas/rejected/` as a rejected-topic note with the reason, so `content-trend-researcher` and the writer do not re-pitch it. Rejection is cheap and expected.
- **Edit → lesson from the diff, NO rewrite (owner decision 2026-07-22).** An `edit` record means the owner hand-fixed the live article themselves — the fix is already live, so never reopen the draft. The diff in the record body is the highest-signal lesson available: what the owner changed is what the writer should have done. Read it closely (what got cut? what got renamed? what tone shifted?) and file the pattern into the byline persona's `## Lessons` or the writer/editor `LESSONS.md`. The post sits at `owner_review_status: in_flight` until the owner thumbs-ups it.
- **Keep / positive signal** → reinforce, don't just log corrections. Note what worked in the relevant persona's `## Lessons` ("floor-level detail landed") so it is repeated. A Keep also marks the post `approved` — fully done in the owner's review lifecycle.

Then move the record: `content/feedback/incoming/` → `content/feedback/routed/` (once the lesson is filed) → `content/feedback/archived/` (end of the run) so it is not re-processed. Never edit live published copy *yourself* — a tweak-rewrite goes back through the writer → editor gate → publisher pipeline, never a direct edit from this goal.

## Weekly Editorial-Quality Audit

The weekly run must inspect the work itself, not only queue health. Use a
default 14-day window and keep the sample bounded:

1. Read up to 20 recent automation drafts that reached `local_preview` or
   `published`. Analyze only the public body above `## Editor Notes`.
2. Read up to 50 of the newest mirrored source articles under
   `content/research/article-archive/`. This is a comparison corpus for pacing,
   reporting density, headline directness, and useful structure. Never copy its
   prose, normalize DJVibe toward another publication's voice, or treat its
   average length as a quota.
3. Record automation-body word count, headline length, paragraph count,
   subheads, pull-quotes, story shape/target when available, and cover source
   kind (`artists`, `gallery`, `archive`, `generic`, or `generated`). Compare
   medians and ranges with the prior weekly report and the external sample.
4. Search article bodies for the stock constructions in `SOUL.md`, especially
   `that's the signal`, `the order is the story`, `that's the move`, `that's the
   point`, `that's the whole difference`, `the interesting question is`, and
   verdict sentences beginning `That is ...` or `This is ...`. Read every hit
   in context; a literal use is not automatically a failure.
5. Read leads and endings. Flag repeated conclusions, throat-clearing, abstract
   industry language, feature furniture on short news, and paragraphs that add
   no sourced fact, concrete scene/object, useful explanation, or reporting-led
   judgment.
6. For an artist-led article, run
   `php artisan djvibe:artist-research-context "<exact artist>" --json` for up
   to three primary artists. Check whether the profile/archive context could
   have made the reporting more specific and whether a generic/generated cover
   was used despite suitable local artist images. Event-specific art may still
   be better; record the editorial reason rather than applying a mechanical
   artist-photo rule.

Write an `## Editorial Quality Audit` section in the weekly report with sample
sizes, medians/ranges, exact recurring phrase counts, image-source mix, two or
three representative examples, and the single highest-leverage lesson.

### Turning evidence into change

- A house-wide lesson requires recurrence across at least three DJVibe articles
  or at least 25 percent of the bounded sample. Append at most one new lesson
  per weekly run to `content-writer/LESSONS.md` or
  `content-editor/LESSONS.md`; do not create a growing list from one-off taste.
- A binding house-voice change still requires an owner proposal under `inbox/`;
  never edit `SOUL.md` directly.
- For at most two affected drafts with explicit `production_status: pending`,
  the retro may request a local-only rewrite by setting
  `review_status: revision_requested`, `revision_source: quality_audit`, and a
  concrete `quality_audit_note`. The writer rewrites, the editor re-gates, and
  the publisher updates the stable local preview through the revision-snapshot
  path.
- Never automatically reopen production-published work from the weekly audit.
  Put the evidence and slugs in an owner proposal. Direct owner Tweak feedback
  continues to use the existing `owner_tweak` path.
- If the sample is clean or too small, record that and make no lesson or rewrite
  request. Tuning should reduce recurring failure, not manufacture churn.

## Signals to track (D14 tripwire input)

Compute per-persona and per-beat **reject/tweak rate** from the feedback records and recent publications. A byline or beat that keeps getting pulled is an early warning: note it in the report and the persona's `## Lessons`. The automatic drop-to-draft-for-review tripwire (D14) is Phase 2 — for Phase 1, surface the signal and recommend, do not auto-throttle.

## Scope

- IN: read and route every record in `content/feedback/incoming/`; move processed records to `routed/` then `archived/`.
- IN: on a `tweak`, reopen the matching draft in `content/drafts/` (`review_status: revision_requested` + `revision_source: owner_tweak` + `owner_note`) so the pipeline rewrites and republishes it.
- IN: append dated lessons to `content/personas/*.md` `## Lessons`, and to `content-writer` / `content-editor` `LESSONS.md`.
- IN: write rejected-topic notes to `content/ideas/rejected/`.
- IN: run the bounded weekly editorial-quality audit against recent DJVibe
  automation bodies and the mirrored external article corpus.
- IN: append at most one evidenced house-wide writer/editor lesson per weekly
  audit.
- IN: requeue at most two explicit production-pending local previews through
  `revision_source: quality_audit`; propose, rather than requeue, changes to
  production-published articles.
- IN: review recent logs/status for the five spine goals and the content queues; append one retrospective report under `log/`.
- IN: propose narrow workflow improvements (or SOUL.md changes) under `inbox/` for owner review.
- IN: update this goal's `STATUS.md` and `LESSONS.md`.
- OUT: writing/editing/publishing articles, editing live copy, mutating the DB or images, editing `SOUL.md` directly, changing cron / model tiers / commit behavior, or overwriting artifacts owned by other content goals.

## Evidence Sources

1. `automations/goals/content-loop-retrospective/STATUS.md`, `LESSONS.md`, latest report
2. `content/feedback/incoming/`, `routed/`, `archived/`
3. content desk status + recent logs:
   - `automations/goals/content-trend-researcher/`
   - `automations/goals/content-writer/`
   - `automations/goals/content-editor/`
   - `automations/goals/content-media/`
   - `automations/goals/content-publisher/`
4. `content/README.md`, queue counts under `content/`
5. `content/personas/*.md` and `content/personas/README.md`
6. open/approved/rejected proposals under `inbox/`
7. `SOUL.md` (reference for house-voice; edited only via proposal)

## Review Questions

Answer from evidence every run:

1. What owner feedback arrived, and where did each note get routed?
2. Which persona or beat is accumulating rejects/tweaks (tripwire watch)?
3. Where did the pipeline stall: feeds, research, briefs, drafting, editing, media, or publishing?
4. What did the bounded editorial-quality audit find in length, cadence,
   headline clarity, structure, and image fit compared with the source corpus?
5. Did drafts hold SOUL voice and avoid unsourced claims / invented credits?
6. What is the single highest-leverage process change for the next cycle?

## Iteration Prompt

1. Read this `GOAL.md`, `STATUS.md`, `LESSONS.md`, and the latest report.
2. Capture branch and dirty status.
3. **Feedback first.** Route every record in `content/feedback/incoming/` per the routing rules; move each to `routed/`, then `archived/` at end of run.
4. Recompute per-persona / per-beat reject-tweak signals; flag tripwire candidates.
5. Process any approved proposals under `inbox/approved/` that are narrow, reversible, and in-scope; move applied ones to `inbox/processed/applied/`.
6. On the scheduled weekly run, execute the bounded 14-day editorial-quality
   audit and apply at most one evidenced lesson plus at most two safe local-only
   revision requests. Skip this step on a narrow feedback-triggered run unless
   the feedback demonstrates a house-wide pattern.
7. Run the weekly process retro over the spine goals and queues (default window: last 7 days).
8. Write new proposals under `inbox/` where a change needs owner review (including any SOUL.md tuning or production-published corpus rewrites).
9. Append a report under `log/YYYY-MM-DD-retrospective-NN.md` with `admin_summary`; update `STATUS.md` and `LESSONS.md`.

## Suggested Command

```cron
25 23 * * 0 cd /home/djvibe/projects/djvibe.com && /usr/bin/env PATH=/home/djvibe/.local/bin:/home/djvibe/.nvm/versions/node/v20.20.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin ./automations/bin/run-goal-cron.sh content-loop-retrospective codex
```

Weekly Sunday at 23:25 PT, plus a five-minute production-feedback poll through `run-content-feedback-cron.sh`. Any Keep/Tweak/Reject starts a pass; Rejects therefore route within roughly five minutes. Registered 2026-07-22 after owner approval.

## Output Ownership

- `automations/goals/content-loop-retrospective/STATUS.md`, `LESSONS.md`, `log/*.md`, `inbox/*.md`
- Appended `## Lessons` in `content/personas/*.md`
- `automations/goals/content-writer/LESSONS.md`, `automations/goals/content-editor/LESSONS.md`
- At most two production-pending `content/drafts/*.md` revision requests from a
  weekly quality audit
- Rejected-topic notes under `content/ideas/rejected/`
- Feedback record movement `incoming/` → `routed/` → `archived/`

## Safety

- Do not publish, draft, edit article bodies, mutate the DB or images, or use
  external tools. The quality audit is local corpus analysis, not new reporting.
- Do not edit `SOUL.md`, cron, model tiers, or commit behavior without explicit operator approval — propose instead.
- Never edit a live post directly. A tweak-rewrite is requeued through the draft pipeline (writer → editor gate → publisher `--update`, which snapshots a revision first); `djvibe:unpublish-post` and `djvibe:rollback-post` are the owner's direct levers.
- Never auto-requeue production-published work from a weekly quality audit.
  Propose it for owner review. Only explicit `production_status: pending` local
  previews may receive the bounded `quality_audit` revision request.
- Do not overwrite artifacts owned by other content desk goals.
