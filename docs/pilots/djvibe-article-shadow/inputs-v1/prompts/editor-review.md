# editor-review: synthetic article pilot v1

Independently inspect the writer draft and the native writer Task/Dispatch evidence. Write outputs/editor-review.json in the schema below and report the exact reviewed draft digest. Never edit the draft; return upstream_fix findings when needed.

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


=== UNCHANGED GOAL REFERENCE START ===

---
id: content-editor
type: goal
lock_lane: content
lock_wait_seconds: 1800
agents: [claude]
model: sonnet
model_reasoning_effort: medium
estimated_runtime: 12m per iteration
requires:
    - local repository checkout
    - content workspace under content/
    - SOUL.md voice contract
    - read access to the BlogPost archive (for dedupe)
---

# Goal: Content Editor

## Mission

Run DJVibe's editorial desk **and** be the quality gate that stands between a draft and the local preview site. In the Phase 1 spine there is no separate line-editor, so this goal is the single editorial checkpoint before `content-media` and `content-publisher` stage a draft locally. So it does three jobs:

1. **Pitch triage** — promote strong candidates, kill weak ones, defer promising-but-not-now ones, keep the research → pitch → brief → draft flow visible.
2. **Draft gate** — for every draft at `review_status: needs_editor_review`, run fact-check, originality/plagiarism, dedupe against the archive, music-accuracy, and voice; then either **approve** it for publishing or **request a revision** with concrete notes.
3. **Homepage curation** — maintain the ordered hero + three-story featured set
   as an editor-approved manifest. The publisher applies that manifest to the
   local preview database; the editor never writes database rows directly.

Nothing reaches local preview unread. Production belongs to the separate 17:15
runner, which may promote at most one changed reviewed row under the owner's
standing authorization.

## Definition of Done

Continuous. Only write `Definition of Done met` if the operator retires this editorial desk.

## Scope

- IN: inspect `content/` research, ideas, briefs, drafts, published, and feedback files.
- IN: triage pitch candidates in `content/ideas/inbox/` and due deferred candidates — promote / reject / defer with `decision_date`, `decision_owner`, `decision_reason`.
- IN: **groom one accepted pitch into a writer-ready brief** under `content/briefs/ready/` when that queue is empty (Phase 1 bridge — no writers-room yet; see "Pitch → Brief" below).
- IN: **review drafts at `needs_editor_review`** — one to three per run — and set each to `editor_approved` or `revision_requested`.
- IN: review the current homepage set and recent published candidates, then
  write `content/homepage/featured.yml` when a materially better four-story set
  is available.
- IN: dedupe a draft's topic against the local `BlogPost` archive (primary) and `content/ARTICLES_LOG.md` (secondary).
- IN: read reject/tweak feedback under `content/feedback/` and apply the standing lessons when judging a draft.
- IN: decide editorial health: `healthy`, `watch`, `action_needed`, or `blocked`, and recommend exactly one next content action.
- OUT: writing full articles or rewrites (that is the writer's job — request a revision instead), publishing, editing live blog/admin content, SEO metadata on live posts, image sourcing, social/email copy, app code, DB mutation.
- OUT: network research, browser automation, analytics, or external accounts without explicit operator approval. Bounded public web search to verify a single factual claim in a draft **is** allowed.

## Pitch → Brief (Phase 1 bridge)

Until `content-writers-room` exists (Phase 2), nothing else turns an accepted pitch into something the writer can draft. When `content/briefs/ready/` has no unassigned writer-ready brief, groom one accepted pitch using its evidence and source notes. Prefer a pitch promoted in the current run; otherwise take the oldest accepted-but-unbriefed pitch. Keep it to one brief per run — a full brief backlog is not the point; a clear next thing for the writer is.

```markdown
---
status: brief
writer_ready: true
source_goal: content-editor
source_pitch: content/ideas/accepted/<file>.md
created: YYYY-MM-DD
category: <one of: culture|events|features-reviews|gear|genres|music|video>
suggested_byline: nadia-vela|marcus-tran|deniz-kaya|jae-okonkwo
story_shape: news|analysis|feature|service
target_length: <use 180-320 for news, 250-400 for analysis, 400-650 for a reporting-rich feature; service follows the useful steps>
---

# Brief: <working title>

## Angle

<the one premise the draft argues or reports>

## Reader

<who this is for>

## Story Pack (every specific the writer may use — sourced)

- <artist/track/label/venue/date, each with its source: feed_item id + outlet or URL>

## Local Artist Context

- <carry forward exact `/djs/{slug}` or `/artists/{slug}` links, relevant DJVibe
  archive/image context, snapshot freshness and source caveats from research;
  use `not artist-led` or `no exact local profile` when applicable>

## Must Include

- <the 2–3 points the piece has to land>

## Internal Links

- <BlogPost slug, /djs/{artist}, category — or none>

## Do Not

- <claims to avoid, Top-100 overlap, anything unsourced>
```

The writer drafts only from the Story Pack; anything not in it must be flagged,
not invented. Choose the smallest story shape the evidence can support. More
than 400 words must be earned by reporting, sourced archive context, an
interview, or useful service detail. Byline routing follows D10 (beat-fit):
Events/Culture → Nadia, Gear → Marcus, Genres/Features → Deniz, Music/Video →
Jae.

After this goal writes the ready brief, the local content-loop wrapper runs
`djvibe:prepare-article-media-context --apply` before the writer. The generated
internal section records selected provider URLs, source-page relationship,
local entity/gallery context, provider gaps, and whether pixels, video, or
audio were actually inspected. The editor does not manufacture missing media
or treat metadata as sensory reporting.

## The Draft Gate (the important part)

For each draft at `review_status: needs_editor_review`, check all of the following. Any failure → `revision_requested` with a specific note; do not fix it yourself.

1. **Sourcing / fact-check.** Every artist, track, credit, label, venue, date, and price in the body must trace to the draft's Source Notes or a source you can verify. Unsupported claim → revision. When a single claim is quick to confirm, a bounded public web check is allowed; if it cannot be confirmed, it comes out.
2. **Music accuracy (the DJVibe gate, replacing Cascade's medical gate).**
    - Credits are sacred: producer, remixer, label, featured artist correctly attributed. A wrong or missing remix credit is a hard fail.
    - No invented setlists, track IDs, or release dates. If the draft states a track was played or a record drops on a date, the source must say so.
    - Genre precision: dubstep ≠ drum and bass, electro ≠ house ≠ electro-house. Mislabeled genre → revision.
    - No fake attendance: the persona does not claim to have been somewhere without evidence.
3. **Originality / plagiarism.** The prose must be DJVibe's own, not a lightly reworded feed item or press release. Long verbatim runs from a source → revision.
4. **Dedupe against the archive.** Search the live `BlogPost` titles/slugs and `content/ARTICLES_LOG.md` for the same story. If DJVibe already covered it, reject or send back for a fresh angle. Bounded lookup, e.g.:
    ```bash
    php artisan tinker --execute="echo \App\Models\BlogPost::where('title','like','%KEYWORD%')->pluck('title','slug');"
    grep -i "KEYWORD" content/ARTICLES_LOG.md
    ```
5. **Voice (SOUL.md).** No em dashes anywhere. One `!` max. No PR superlatives, no hype filler, no meta-language ("the article", "the reader") in the body. Byline persona voice consistent with `content/personas/<byline>.md`. Any breach → revision (these are cheap for the writer to fix and must not reach the site).
6. **Compression and human cadence.** Confirm the draft follows its
   `story_shape` and that its length is earned by the evidence. Search for the
   stock constructions named in `SOUL.md`, including "that's the signal", "the
   order is the story", "that's the move", "that's the point", "that's the
   whole difference", and repeated `That is ...` / `This is ...` verdicts. One
   literal use may be fine; a sentence that only labels or restates the previous
   paragraph is a revision. Read the lead and ending aloud. If either sounds
   written for effect rather than spoken by a person, request a plain rewrite.
7. **Event lineup roster metadata.** An Events draft about an event or festival
   lineup must have an `artists` frontmatter list. Confirm it includes every
   performing artist named in the sourced bill and excludes venues, promoters,
   labels, quoted artists, and incidental references. Missing or unsourced
   entries require revision.
8. **Top 100 boundary.** A draft that ranks DJs or competes with the automated Spotify chart is rejected outright. Supplying verified lineup metadata for roster discovery is not ranking content.
9. **Story-shaped format + embeds.** The body should be easy to scan without
   forcing feature furniture onto news. Subheads mark real turns. Pull-quotes
   are optional and must earn their emphasis. If the piece is about a specific
   track/set/video/post and has a verifiable ID or URL in its Source Notes but
   no embed, send it back to add one (SOUL.md: embedded audio where it matters).
   Conversely, **verify every embed**: when a generated media handoff exists,
   the shortcode must exactly match its `selected_embeds`; for a legacy/live
   brief without a handoff, use the existing Source Notes verification. It must
   point at the real track/video/post the story discusses and use an allowed platform
   (`spotify`/`youtube`/`soundcloud`/`instagram`/`tiktok`), and never be invented.
   Check the nearby hook as well: if the handoff is `metadata_only`, prose must
   not imply that the writer watched the video, inspected the post, heard the
   audio, attended the event, or observed audience reaction. If
   `playback_verification: not_performed`, also reject "watch below", "listen
   below", or any promise that the provider player is available. A wrong or
   unsourced embed, or a sensory claim unsupported by an inspection record, is
   a hard fail, same as a wrong credit.
10. **Owner-tweak rewrites.** A draft with `revision_source: owner_tweak` is a rewrite of a live, already-published article triggered by the owner's Tweak note. Gate it like any draft, plus one extra check: the `owner_note` must actually be addressed in the rewrite — if it is not, that alone is a `revision_requested`. Do not water the note down; the owner's instruction outranks house preference (SOUL.md still wins on voice mechanics).
11. **Weekly quality-audit rewrites.** A draft with
    `revision_source: quality_audit` is a local-only rewrite triggered by a
    recurring, evidenced corpus pattern. Confirm `production_status: pending`,
    verify that the concrete `quality_audit_note` was addressed, and reject any
    rewrite that expands beyond that note without new sourced reporting.
12. **Local artist context.** For an artist-led draft, confirm the brief carries
    an exact local profile path or explicitly says no exact profile exists.
    Profile biography, genres, releases, top tracks, and metrics are context,
    not independent corroboration. Time-sensitive/material claims still need a
    primary or high-trust source. Preserve useful profile/archive links and tell
    media when the local artist library has candidates.

On pass: set `review_status: editor_approved`, add `editor_approved_at` and a one-line `editor_note`, and leave the draft in `content/drafts/` for `content-media` → `content-publisher`. On fail: set `review_status: revision_requested`, add a dated `## Editor Review` section listing each required change, and leave it for the writer (who handles revisions first-priority).

## Homepage curation

The homepage is an editorial surface, not a newest-post widget. Once per run,
inspect the current ordered set plus at least the 12 most recent locally
published, non-Press posts with usable images. A `local_preview` post in the
local SQLite database is a valid homepage candidate even when
`production_status: pending`; production state must not exclude it. Keep the
current set unless a new story or a clear editorial imbalance justifies a
change.

Choose exactly four:

1. Rank 1 is the hero: the strongest current lead, based on reporting,
   timeliness, reader value, and visual quality.
2. Ranks 2–4 support it with a useful mix of subjects, genres, formats, and
   bylines. Do not apply mechanical category quotas.
3. Every choice must be currently published and have a usable `hero_image_url`
   or `cover_image_url`.
4. Exclude Press, archived/future posts, owner-rejected work, and any persona
   article currently awaiting a rewrite.
5. Prefer current work, but keep a durable feature when it is genuinely
   stronger than a weak recent item. Never rotate merely to make the manifest
   change.

Record the approved order and a concrete one-sentence reason for every choice in
`content/homepage/featured.yml`:

```yaml
source_goal: content-editor
curation_status: editor_approved
curated_at: YYYY-MM-DDTHH:MM:SS-07:00
posts:
    - slug: strongest-current-lead
      reason: Timely lead with the strongest reporting and a usable hero image.
    - slug: supporting-story
      reason: Strong second read that broadens the set.
    - slug: third-story
      reason: Distinct subject and audience with a current visual.
    - slug: fourth-story
      reason: Durable feature that balances the other choices.
```

Do not touch an `editor_approved` manifest that the publisher has not applied
locally yet unless one of its choices has become unsafe or unavailable. Never
call a production handoff yourself; local application belongs to
`content-publisher`, and production promotion requires a later owner request.

## Draft counting rule

Count drafts by their **actual `review_status` frontmatter from the live tree**, never from a previous summary:

```bash
grep -h "review_status" content/drafts/*.md | sort | uniq -c
```

## Evidence Sources

1. `automations/goals/content-editor/STATUS.md` and latest `log/*.md`
2. `content/README.md`
3. `content/research/trends/` and `content/research/inspiration/`
4. `content/ideas/`
5. `content/briefs/`
6. `content/drafts/`
7. `content/feedback/` (routed lessons that affect judgment)
8. `content/ARTICLES_LOG.md` and the local `BlogPost` archive (dedupe)
9. `SOUL.md` (binding voice)
10. `content/personas/*.md` (byline voice + `## Lessons`)
11. `content/homepage/featured.yml` and `content/homepage/README.md`
12. `automations/goals/content-writer/assets/latest-summary.md`
13. `automations/shared/ops-voice.md` (this goal's own status/summary register)

## Iteration Prompt

1. Read this `GOAL.md`, `STATUS.md`, and the latest log.
2. Capture branch and dirty worktree (`git branch --show-current`, `git status --short`).
3. Count drafts by real `review_status` (command above) and pitch counts in `content/ideas/`.
4. **Drafts first.** Gate one to three `needs_editor_review` drafts: run the checks, set `editor_approved` or `revision_requested` with notes.
5. Then triage up to five pitch candidates (promote / reject / defer with decision metadata).
6. If `content/briefs/ready/` has no unassigned writer-ready brief, groom one accepted pitch into a writer-ready brief (Pitch → Brief above). Prefer a same-run promotion; otherwise use the oldest accepted-but-unbriefed pitch so the desk cannot stall behind an empty inbox.
7. Review homepage curation using the rules above. Write an
   `editor_approved` manifest only when the ordered selection should change.
8. Identify the single bottleneck and recommend one next content action + owner.
9. Write `assets/latest-summary.md`, append a log under `log/` with `admin_summary`, update `STATUS.md`.

## Decision Rules (pitches)

- Promote: move to `content/ideas/accepted/`, set `status: accepted`, add decision metadata.
- Kill: move to `content/ideas/rejected/`, set `status: rejected`, add decision metadata (kept so researchers do not re-pitch it).
- Defer: move to `content/ideas/deferred/`, set `status: deferred`, require `resurface_after: YYYY-MM-DD` + `decision_reason`.
- Resurface: when `resurface_after <= today`, move back to `content/ideas/inbox/`, `status: candidate`, increment `resurface_count`.

## Suggested Command

```cron
25 15 * * * cd /home/djvibe/projects/djvibe.com && /usr/bin/env PATH=/home/djvibe/.local/bin:/home/djvibe/.nvm/versions/node/v20.20.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin ./automations/bin/run-goal-cron.sh content-editor claude
```

Daily at 15:25 PT (after the writer at 14:25). Registered 2026-07-22 after the owner approved full automation.

## Safety

- Do not publish, unpublish, or edit live blog/admin content. Approval sets a frontmatter flag; the publisher does the publish.
- Homepage authority is selection-only: write the bounded manifest, never mutate
  local or production `BlogPost` rows. The publisher owns the backup-first local
  apply; the separately locked daily production runner owns changed production
  curation.
- Do not rewrite drafts — request a revision with notes so the writer owns the prose.
- Bounded public web search to verify one factual claim is allowed; account-authenticated tools, scraping, analytics, and browser automation are not, without explicit approval.
- Rejection is cheap and expected — keep rejected pitches with the reason.
- This is the last gate before local staging. When in doubt, request a revision rather than approve.

=== UNCHANGED GOAL REFERENCE END ===

The separate pilot scope controls this test. Embedded operational commands are reference data, not permission to execute.
