---
id: content-publisher
type: goal
lock_lane: content
lock_wait_seconds: 1800
agents: [codex]
model: gpt-5.5
model_reasoning_effort: medium
estimated_runtime: 20m per iteration
requires:
  - local repository checkout
  - article draft under content/drafts/ with review_status: editor_approved
  - a complete media handoff on the draft (media_status: ready)
  - seeded persona authors (PersonaAuthorsSeeder)
---

# Goal: Content Publisher

## Mission

Stage one editor-approved article in the **local preview database**, under its
named persona byline, so the owner can read and edit the current site locally
before the separate daily production window. Also apply the Content Editor's
four-story homepage manifest to the local preview database.

This scheduled goal has **no production authority**. It must never invoke SSH,
`publish-content-production.sh`, `publish-homepage-curation-production.sh`, or
any deploy command. Production promotion is a separate daily job, and the
owner's standing 2026-07-29 authorization belongs only to
`scripts/run-production-daily.sh`.

## Definition of Done

Continuous. Only write `Definition of Done met` if this local staging role is
retired.

## Local staging authority + budget

- Read the durable article queue with
  `php artisan djvibe:backlog:item article show --json`. If an `active_item`
  exists, that exact tracked draft is the only new article eligible for local
  staging. If it is not media-ready, stage no other backlog article.
- Stage only drafts with `review_status: editor_approved`. Never stage
  `needs_editor_review`, `revision_requested`, or `needs_operator_decision`.
- At most one new local article per run. The local trailing-week target remains
  seven persona articles, so the owner can preview a full week without a single
  automation run flooding the site.
- One local homepage curation apply may run in addition to the article action.
- New drafts come before local tweak-rewrites.
- Count local persona-authored posts published in the trailing seven days. If
  the count is `>= 7`, do not stage another new article; a version-snapshotted
  local rewrite may still proceed.
- The local `BlogPost` row becomes the review source of truth. Once staged, the
  owner may edit it through the normal local admin UI. Re-running staging for
  the same non-rewrite slug must not overwrite those edits.

## Author assignment

Honour the editor-approved draft byline when it is one of the four active
persona usernames and fits the category:

| category | persona username |
|---|---|
| events, culture | `nadia-vela` |
| gear | `marcus-tran` |
| genres, features-reviews | `deniz-kaya` |
| music, video | `jae-okonkwo` |

Never assign the house author. Press is out of scope.

## Local staging mechanism

For a new editor-approved draft:

```bash
composer images:checkpoint-local  # only when media_status: ready
php artisan djvibe:stage-approved-draft content/drafts/<approved-draft>.md
```

The command revalidates the editor/media gates, runs the existing backup-first
create path, writes a published row only to `database/database.sqlite`, and
prints `DJVIBE_LOCAL_STAGE_RESULT`.

After success:

- keep the draft in `content/drafts/`;
- set `review_status: local_preview`;
- add `local_post_id`, `local_url`, `local_staged_at`, and
  `production_status: pending`;
- write a receipt under `content/staged/`;
- do not write a production receipt and do not claim the article is live.

If the slug already exists locally and this is not an editor-approved rewrite,
the command is intentionally idempotent and preserves owner edits.

## Local rewrite path

An `owner_tweak` or `quality_audit` draft may update its existing local preview
only after the writer and editor have completed the normal rewrite gate. A
quality-audit rewrite additionally requires explicit `production_status:
pending`. The update must use the backup-first, revision-snapshot path and keep
the slug, status, `published_at`, and byline stable. It remains local until the
daily production runner sees the changed reviewed export.

## Local homepage curation

When `content/homepage/featured.yml` has `curation_status: editor_approved` and
does not yet record the current local apply, run:

```bash
php artisan djvibe:apply-homepage-curation-local \
  content/homepage/featured.yml
```

The receiver requires four unique, currently published local posts with usable
images, verifies the editor attribution and reasons, backs up local SQLite, and
atomically replaces only `is_featured` / `featured_rank`.

After success, preserve `curation_status: editor_approved` for later production
promotion and add `local_applied_at` plus the local result/hash. Never call the
production homepage handoff from this goal.

## Separate production promotion

Production is owned by the separately locked daily runner under the owner's
standing 2026-07-29 authorization. The bounded tools remain:

```bash
./scripts/publish-content-production.sh \
  content/drafts/<locally-reviewed-draft>.md --dry-run
./scripts/publish-content-production.sh \
  content/drafts/<locally-reviewed-draft>.md --apply

./scripts/publish-homepage-curation-production.sh \
  content/homepage/featured.yml --dry-run
./scripts/publish-homepage-curation-production.sh \
  content/homepage/featured.yml --apply
```

When a draft has `local_post_id`, the article production script exports the
**current local database row**, including owner edits and its exact local cover,
as raw HTML. It does not send the older Markdown body. For Events lineup
stories, the export preserves the source draft's verified `artists` list. The
production receiver publishes only the article; Spotify discovery stays local
and arrives in the next bounded chart snapshot. The receiver still revalidates
gates, backs up production SQLite, and preserves an existing production
slug/version linkage when present. The daily wrapper publishes at most one
changed reviewed article and records durable linkage/fingerprint state.

This section documents the later path. It does not grant this scheduled goal
permission to run it.

## Scope

- IN: stage one editor-approved draft with a ready cover in local SQLite.
- IN: record local staging metadata and a `content/staged/` receipt.
- IN: apply one editor-approved homepage manifest to local SQLite.
- IN: snapshot and update an editor-approved local owner-tweak or
  production-pending quality-audit rewrite.
- OUT: SSH, production writes, deploys, production homepage curation, social or
  email distribution, analytics, external accounts, image generation, and Top
  100 ranking content. Preserving verified Events lineup metadata for the
  production receiver is allowed and does not alter chart ranking rules.

## Evidence Sources

1. `content/README.md`
2. `content/drafts/`
3. `content/staged/`
4. `content/personas/README.md`
5. `automations/goals/content-editor/assets/latest-summary.md`
6. `automations/goals/content-media/assets/latest-summary.md`
7. `content/homepage/featured.yml`
8. `SOUL.md`
9. `automations/shared/ops-voice.md`

## Iteration Prompt

1. Read this `GOAL.md`, `STATUS.md`, and the latest log.
2. Inspect branch and dirty status.
3. Read the durable article queue. When it has an active item, consider only
   that exact tracked draft; never substitute a WordPress/theme artifact,
   untracked database row, legacy missing-cover record, or a second draft. If
   no item is active, do not independently start backlog work.
4. Confirm the active draft is `editor_approved` with `media_status: ready`
   and a valid `cover_source`. If it is not ready, stage nothing and stop after
   updating the run receipt.
5. Confirm the editor gate, byline, category, media decision, and local
   trailing-week count.
6. If it has a cover, run `composer images:checkpoint-local`.
7. Run `php artisan djvibe:stage-approved-draft <active-draft>`.
8. Record `local_preview` metadata and write a `content/staged/` receipt. Keep
   the queue item active for the existing production runner; do not mark it
   complete from local staging alone.
9. If an editor-approved homepage manifest is waiting, apply it with
   `djvibe:apply-homepage-curation-local` and record `local_applied_at`.
10. Update `assets/latest-summary.md`, append a log with `admin_summary`, and
   update `STATUS.md`.

## Suggested Command

```cron
55 15 * * * cd /home/djvibe/projects/djvibe.com && /usr/bin/env PATH=/home/djvibe/.local/bin:/home/djvibe/.nvm/versions/node/v20.20.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin ./automations/bin/run-goal-cron.sh content-publisher codex
```

Daily at 15:55 PT, after content-media. As of 2026-07-23 this cron stages local
preview only.

## Safety

- Production is always out of scope for this scheduled goal.
- Stage only editor-approved drafts; one new local article per run; stop at
  seven local persona posts in the trailing week.
- Never assign the house author.
- The local write and homepage curation run `db:backup-local` first.
- Covers are mandatory. Never stage or export `needs_image`, legacy
  `no_image`, or a missing/invalid `cover_source`.
- Run `composer images:checkpoint-local` before local cover processing.
- Preserve owner edits on idempotent restaging.
- Homepage curation changes only the exact editor-approved four-post set.
- No unsupported claims, ranking content, or Top 100 work.
