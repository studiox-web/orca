---
id: content-media
type: goal
lock_lane: content
lock_wait_seconds: 1800
agents: [codex]
model: gpt-5.6-luna
model_reasoning_effort: medium
estimated_runtime: 12m per iteration
requires:
    - local repository checkout
    - content workspace under content/
    - the Media Library (djvibe:find-cover / djvibe:stash-cover)
    - agy is optional and operator-only for constrained public-page search; the unattended goal must remain useful without it
    - Spotify Web API credentials for verified artist-profile photos
---

# Goal: Content Media

## Mission

Give each editor-approved draft the best-fitting cover image, plus honest alt
text. The same media system now also prepares a small, metadata-only remote
embed handoff from a writer-ready brief before drafting. The pre-writing
command validates exact source URLs and reports local catalogue context; this
goal still owns the separate cover bytes, visual review, provenance, credit,
and rights decision after editor approval. It does not generate variants (the
app's `ImageService` does that at publish) and it does not publish.

The rule, from the old DJVibe media desk: **get several candidates, look at them, and pick the best fit — never grab the first result.** Default to a recognizable photograph over artwork because faces, performers, venues, crowds, and real gear usually make stronger thumbnails. Use album or single artwork only when the story is specifically about that exact release or its cover, and verify the artwork is exact.

## Definition of Done

Continuous. Only write `Definition of Done met` if this media role is retired.

## Durable one-item queue

The article backlog is coordinated by the tracked state and append-only receipts
under `automations/goals/content-media/state/`. At the start of every run, use:

```bash
php artisan djvibe:backlog:item article next --claim --json
```

Resume the returned `active_item`; never select a second article while it is
active. The selector considers only tracked Markdown drafts that are
`editor_approved` and still lack ready media. It intentionally excludes old
WordPress/theme database artifacts and the legacy published-post missing-cover
gap. When media is ready, leave the item active for content-publisher and the
daily production runner. A later run observes the production linkage receipt,
marks the item complete, and may then claim the next item.

Do not retry an item with the same known blocker. Record a future retry time or
an observable retry condition with `block`. Archive only with an allowlisted
basis, a reason, and two independent evidence entries; archives remain
recoverable with `reactivate`. A supported manual fallback must also write a
`manual` receipt containing the action, outcome, and a concrete process
improvement. Use `php artisan djvibe:backlog:item --help` for the exact flags.

## Source ladder (owned first, verified web sources after)

For the local manual content loop, remote embeds are prepared before the
writer with:

```bash
php artisan djvibe:prepare-article-media-context content/briefs/ready/<brief>.md --apply --json
```

This step recognizes only renderer-supported Instagram, YouTube, Spotify,
SoundCloud, and TikTok URLs found directly in the brief/retained feed text or
on a cited source page. Only an exact URL explicitly placed in the approved
brief is selected automatically. Feed URLs, source-page links/embeds, and local
catalogue matches stay candidate-only because provenance does not prove story
relevance or playback. It records metadata-only inspection flags and honest
per-provider gaps. It never downloads or
rehosts provider media, and it does not decide cover reuse rights. General
Instagram search is unavailable; YouTube discovery is limited to cited pages
and the locally synced DJVibe catalogue; credentialed Spotify search is not run
by this command.

Use the Media Library, which searches all owned sources at once, before ever going to Google. "Local first" means reuse an exact relevant asset when one exists; it does not mean settling for a generic local image merely to avoid the supported external search path:

```bash
php artisan djvibe:find-cover "<subject>" --json          # library + galleries + archive
php artisan djvibe:find-cover "<artist>" --source=library --limit=40 --json
php artisan djvibe:find-cover "<subject>" --source=galleries --json
```

The local library now includes tens of thousands of provider-archived artist
masters: profile and cover photos, artist-gallery frames, release artwork, and
top-track artwork. They are already searchable through `find-cover`; do not
assume a missing old blog cover means the artist library is thin.

Priority:

1. **Working library** — `content/media/library/` (the curated, self-growing store; find-cover checks it first, including the large local artist archive).
2. **Artist directory** — exact local `spotify_artists` matches may already carry primary, cover, and gallery URLs even when the primary `image_url` is empty. Stage and review all returned candidates before any web search.
3. **Public galleries** — ~5,900 owned DJVibe event photos (performance / crowd / venue — the 3-shot gold).
4. **Article archive** — thousands of imported DJVibe posts carry local cover/hero files or legacy inline image references. `find-cover` indexes only locally present, subject-associated files; review relevance and rights rather than treating possession as permission.
5. **Originating RSS and article source pages** — retained feed media,
   enclosures, Open Graph/schema images, and credited article/gallery
   photographs. Source URLs establish provenance, not reuse permission.
6. **Spotify artist profile** — verified real artist photography. If a named
   artist is absent from the chart roster, run
   `djvibe:discover-spotify-artist "<artist>"`; only an exact unique result may
   auto-add and hydrate the artist. An ambiguous result needs operator review.
7. **Constrained public-page search (agy)** — the second required discovery
   branch for every article, regardless of how many local candidates exist. It
   may make exactly one public search call and returns source pages for the same
   safe extraction path. Local and online candidates meet in one merit-ranked
   set; local hits never suppress the public search. It must not bypass
   paywalls, login walls, robots controls, CAPTCHAs, or access boundaries.

## Get options, then pick (the important part)

1. For an Events draft with an `artists` lineup list, first run:
    ```bash
    php artisan djvibe:discover-event-artists content/drafts/<draft>.md --json
    ```
    This attempts every sourced performer, including artists that are not cover
    candidates. Exact unique matches join and hydrate the local chart roster.
    Existing artists are idempotent. Record missing or ambiguous names for
    operator review, but continue the independent cover search.
2. Derive the **subject** and image job from the draft/brief: artist portrait or
   performance, exact event/festival, venue, real gear, or exact release
   artwork. Photography is the default. For festival and special-event
   coverage, the first-choice job is a photograph from that exact event and
   year; search the exact event name first, then event + year + named artist or
   venue. Use release artwork only for a story about that exact album, single,
   or cover.
3. Search the complete local artist archive explicitly before the mixed search:
   `djvibe:find-cover "<artist>" --source=library --limit=40 --json`. Then search
   the exact release/track title when relevant, followed by the mixed
   library/gallery/article archive search. The archive tier includes imported
   cover/hero files and locally present legacy inline images when their title,
   alt/title text, or filename matches the subject. Review the set, not only
   the first eight newest files.
4. Match the asset to the article and to the thumbnail job:
   - Prefer a real, recognizable photograph over illustration, release art,
     logos, or promo graphics. For artist stories, prefer a performance frame
     or clear portrait; for venue/event stories, prefer photography from the
     exact named event and year, showing its venue, stage, crowd, or performer;
     for gear stories, prefer the exact hardware or a sourced photograph of the
     person using it.
   - Inspect the likely 400x300 crop. Favor an identifiable face or strong
     subject that remains legible when small, with enough space to crop without
     cutting away the subject.
   - Album or single artwork is eligible only when the article is specifically
     about that exact release or its cover. Never use unrelated catalogue art
     as a stand-in for an artist photograph merely because a name token matches.
   - A generic artist photograph is a lower-quality fallback for event
   coverage, not equivalent to an exact event frame. The supported external
   path runs regardless of whether local search has an exact event/year match.
     If a portrait is ultimately proposed, label it as generic artist
     illustration and never present it as the named event, venue, city, or year
     unless the source proves that context.
5. For an exact artist-directory match, stage its recorded primary, cover, and
   gallery candidates alongside the broader web search. This works even when the
   primary image is empty:
    ```bash
    php artisan djvibe:stage-spotify-cover "<artist>" --json
    # If the artist is missing:
    php artisan djvibe:discover-spotify-artist "<artist>" --json
    php artisan djvibe:stage-spotify-cover "<artist>" --json
    ```
    Spotify can expose a primary image, wide cover, and several distinct
    gallery photographs. Review every returned image; do not assume `cover`
    means album art or that every gallery frame is a photograph. Prefer the
    clearest identifiable photograph with the strongest crop, not simply the
    largest file.
6. Run the article-aware discovery command. It combines the complete local
   library/archive branch, retained feed media and originating source pages,
   and one constrained public-page search before applying the final ranking:
    ```bash
    php artisan djvibe:discover-article-media content/drafts/<draft>.md --json
    ```
    Local results never short-circuit the online branch. Use a specific query.
    For event coverage, query the exact event name and
    year first, then add the named artist or venue
    (`"<event> <year> <artist>"`). A generic artist query is only a fallback after that exact
    event search. You get 3–5 ranked, staged options with source-page URL,
    direct image URL, credit, rights-review state, and preview path. Search
    failures preserve the successful branch and produce
    `coverage_status: partial` plus per-branch `source_status`; never report a
    local-only or web-only run as complete. Access denial is a diagnostic,
    never permission to broaden tool access or retry through an alternate
    bypass. Rejected thumbnails, icons, inline data placeholders, and undersized
    chrome are candidate rejections, not source-page fetch failures; report the
    two counts separately so source coverage remains truthful.
7. The **content-media reviewer running this goal owns final media selection**;
   this is not handed back to the content-editor or delegated to the publisher.
   Review the combined candidate set against the quality bar and pick the best cover,
   optionally adding other genuinely useful article photographs:
    - **Visual quality and thumbnail fit are the hard gate:** inspect the actual
      image and its likely 400x300 crop. Prefer width >= 800px and landscape for
      the 1200x800 cover, but do not reject a clean local or verified Spotify
      photograph solely because efficient compression puts it below 180KB.
      File size is a diagnostic for tiny/error files, not proof of visual
      quality. The web downloader's 180KB acquisition floor remains its normal
      default for untrusted web candidates.
    - **Photograph first:** performance, clear portrait, exact venue/event
      scene, crowd, or real gear before artwork. Album/single art is an
      exception for a story specifically about that exact release or cover.
    - **No watermarks, no logo-stamped or promo-overlay images, no obvious AI-fake of a real event.** Inspect the image file itself where the runtime lets you see it; otherwise judge on dimensions, byte size, source tier, and caption/subject match.
    - **Subject + context fit:** an artist piece wants that artist; festival and
      special-event coverage wants a verified frame from that exact event and
      year; a gear piece wants the exact hardware or clearly relevant working
      context. A wrong-subject image (artist A on a story about artist B) is
      never acceptable, even if it is pretty. A generic portrait for an event
      remains an explicitly weaker fallback and must not end the search merely
      because it is local.
    - **3-shot preference:** performance shot first, then portrait, then
      venue/crowd, while favoring the frame with the clearest small-thumbnail
      subject and most usable crop.
    - **Not a near-duplicate** of a cover used on a recent post.
    - **Search results are never proof.** Visually inspect each candidate and
      verify the source page. Reject an unrelated image even when its dimensions
      pass. Search-engine fallback results are especially prone to false matches.
    - A verified Spotify photograph may pass at 640px when it is the strongest
      official image available, remains clear at thumbnail size, and crops
      cleanly. The normal untrusted web-image acquisition target remains
      >=800px and >180KB.
8. **Record the reviewed selection** (cover first). This promotes every chosen
   image into the deduplicated private library and writes its full provenance
   into the draft:
    ```bash
    php artisan djvibe:select-article-media content/drafts/<draft>.md <run-id> candidate-1 [candidate-2 ...]
    ```
    Existing gallery/archive images are already local and can be referenced in
    place after review; you only need to stash staged/downloaded images (they
    have no permanent home yet). Existing possession is not proof of usage
    permission. Keep `review_required` unless recorded evidence supports
    `owned`, `licensed`, or `open`.
9. Keep `review_required` unless recorded evidence supports `owned`,
   `licensed`, or `open`. Editorial selection is not a rights determination.

If nothing clears the quality bar, set `media_status: needs_image` with a
one-line reason. This is an actionable backlog state, not a publishable media
decision. Every article requires a cover before local staging or production.

## Media handoff shape (added to the draft frontmatter)

```yaml
cover_source: content/media/library/artists/<file>.webp # or a storage/app/public/... owned path
cover_alt: 'Amelie Lens behind the CDJs at Awakenings, red stage light'
cover_credit: 'Photo: Jane Roe' # or omit if unknown
cover_origin: https://cdn.example/photo.jpg
cover_source_page: https://publisher.example/event-gallery
cover_rights_status: review_required
additional_media: # optional; each selected image follows the same provenance rules
  - source: content/media/library/festivals/<file>.jpg
    origin: https://cdn.example/second-photo.jpg
    source_page: https://publisher.example/event-gallery
    credit: 'Photo: Jane Roe'
    rights_status: review_required
media_status: ready
```

Local staging passes the cover and any additional selections through
`ImageService::processBlogImage()`, producing the normal cover, gallery, and
thumbnail variants. Discovery and selection preserve alt, credit, source-page,
direct-image, and rights-review fields separately.

## Alt text + credit

- Describe what is actually in the frame, **<= 125 characters**, no keyword stuffing, no "image of". Name the artist when confident it is them. **Do not name a specific event, festival, venue, year, or city you cannot verify from the image's own source** — a Google result rarely proves where it was shot, so describe the frame generically ("hands raised to the crowd") instead of inventing "at <Festival> 2026". Inventing a location in alt text is the same failure as inventing it in the body.
- Credit the photographer/source when the candidate record carries it (credits are sacred, SOUL.md). Carry it into `cover_credit`.

## Scope

- IN: read tracked drafts at `review_status: editor_approved` without a ready
  media handoff, selected through the durable one-item queue.
- IN: search the reusable library, exact artist-directory images, public
  galleries, subject-associated legacy blog media, retained RSS media, and
  originating source pages before constrained public-page search; review every
  candidate set.
- IN: pick the best-fit cover and, where useful, additional article photographs
  against the quality bar + 3-shot recipe.
- IN: promote reviewed selections into `content/media/library/` through
  `djvibe:select-article-media` (or `djvibe:stash-cover` for legacy/manual
  intake).
- IN: discover and hydrate exact-match Spotify artists so the chart and media
  roster expand together.
- IN: write the media handoff (`cover_source`, `cover_alt`, `cover_credit`, `cover_origin`, `media_status`).
- IN: attach a vetted cover to an existing local preview with
  `djvibe:attach-preview-cover`.
- IN: note recurring library gaps in the log.
- OUT: generating image variants, publishing, editing live content, generating persona avatars, or touching app code / the DB directly (the commands do the file work).

## Evidence Sources

1. `content/README.md`
2. `content/drafts/` (drafts at `editor_approved`) and their briefs
3. `djvibe:find-cover` output (library + galleries + archive)
4. `content/media/library/` sidecars (what is already stashed)
5. `SOUL.md` (credits sacred; caption discipline)
6. `automations/goals/content-editor/assets/latest-summary.md`
7. `automations/shared/ops-voice.md` (this goal's own status/summary register)
8. `docs/projects/media-specialist/context/quality-standards.md` (the legacy quality bar this goal inherits)

## Iteration Prompt

1. Read this `GOAL.md`, `STATUS.md`, and the latest log.
2. Inspect branch and dirty status.
3. Atomically claim or resume the one durable article item with
   `djvibe:backlog:item article next --claim --json`. If none is due, update the
   run summary and stop. Never substitute WordPress artifacts, untracked
   database rows, or legacy published-post cover gaps.
4. Process exactly that **one** item. If it is already media-ready, leave it
   active for the downstream local and production publishers and stop.
5. For an Events lineup draft, attempt its full structured `artists` list with
   `djvibe:discover-event-artists` before choosing the cover subject. Exact
   event ranking requires editor-verified `event_name`, `event_year`, and
   `event_evidence` frontmatter, plus `event_location` whenever the coverage is
   about one stop of a multi-city event; never infer the event year from a
   publication date elsewhere in the draft.
6. For each item, derive the subject and run
   `djvibe:discover-article-media <draft> --json`. It reviews owned, RSS, and
   originating source-page candidates and records the required Antigravity
   branch as blocked. Until pre-execution search-only containment exists,
   Antigravity is operator-only and must not be enabled by this scheduled goal;
   therefore unattended manifests are honestly `coverage_status: partial` and
   must remain `needs_image`. An operator in an isolated search-only environment
   may rerun with `--web-search` to complete both branches. A pending
   `feed_item_media` migration degrades RSS media enrichment to unavailable;
   it must not crash discovery or trigger a migration from this goal.
   The installed Antigravity CLI currently exposes no pre-execution per-tool
   allowlist, so its receipt checks are post-execution validation, not safe
   unattended containment. No credentialed search SDK/provider is integrated;
   do not represent a missing Tavily or other API key as a completed web search,
   and do not accept provider terms, create accounts, or add credentials from
   this goal.
7. Once both required branches have completed, pick the best cover and any
   useful additional photographs. Visually inspect them and verify their source
   pages; never trust rank or dimensions alone.
   Record the choices with `djvibe:select-article-media`. If the manifest says
   `candidate_status: partial` or `insufficient`, leave the item at
   `needs_image`; the normal target is three to five qualified choices from a
   complete discovery run.
8. Write `media_status: ready`. For an existing local preview, rerun
   `djvibe:stage-approved-draft <draft>` to reconcile `additional_media`
   idempotently, then run
   `djvibe:attach-preview-cover <local_post_id> <cover_source>` for the cover.
9. If no candidate clears the bar, leave `media_status: needs_image`, then
   record the blocker with a future `--retry-after` or observable
   `--retry-when`; do not immediately reclaim it with unchanged conditions.
10. Note recurring library gaps, write any required transition/manual receipt,
    then update summary, log, and status.

## Suggested Command

```cron
40 15 * * * cd /home/djvibe/projects/djvibe.com && /usr/bin/env PATH=/home/djvibe/.local/bin:/home/djvibe/.nvm/versions/node/v20.20.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin ./automations/bin/run-goal-cron.sh content-media codex
```

Daily at 15:40 PT (after the editor at 15:25). Registered 2026-07-22 after the owner approved full automation.

## Safety

- Get several candidates and pick the best; never publish the first grab.
- Every article requires an image. `needs_image` blocks staging/export and is
  retried; it is never permission to ship without a cover.
- Photograph-first thumbnail fit is a hard gate: prefer recognizable subjects,
  clean 400x300 crops, and normally >=800px width. Compressed byte size alone
  does not establish quality; a verified official Spotify photograph may pass
  at 640px after visual review. No watermarks/logos, and the right subject are
  mandatory. Release artwork is reserved for stories specifically about that
  exact release or cover.
- Web-search candidates are owner-approved sources only after visual and source
  verification; record `cover_origin` and credit for provenance.
- Antigravity web search is never automatic yet. Its observed permission mode is
  `request-review`, and the client can only reject extra tool use after the CLI
  has run; rejection does not prevent or undo side effects. Only an operator in
  an isolated search-only environment may pass `--web-search`. Automatic dual-
  source execution requires a pre-execution tool allowlist that exposes only
  `search_web`; prompt instructions and post-execution receipt checks are not
  containment.
- For a bounded diagnostic run that must not touch the normal media staging or
  manifest directories, redirect Laravel storage to a fresh temporary
  directory and omit `--web-search`, for example:
  `LARAVEL_STORAGE_PATH=/tmp/<fresh-dir> php artisan djvibe:discover-article-media <draft> --limit=5 --json`.
  This may fetch only the draft's already-recorded public source pages and
  writes any downloaded candidates and manifest under that temporary root. It
  must not be followed by selection, local staging, or publishing.
- Do not publish, generate variants, or edit live content.
- Mind the inode cap: the library is a bounded working store; the periodic prune keeps staging tidy. Do not bulk-import beyond what covers need; check `uapi Quota get_local_quota_info` before any large drop (root CLAUDE.md).
