# content/ — DJVibe editorial workspace

The file-based workspace the content-automation loop runs through. The site is canonical (POSSE, D19); this folder is where research, drafts, and editorial handoffs live before a post becomes a `BlogPost` row. Repo-relative only — the old `D:\DJVIBE\...` paths are dead.

See `docs/projects/AUTOMATION-STATUS.md` for live state and
`docs/projects/AUTOMATION-MIGRATION-PLAN.md` for the implemented design plus
remaining depth. Voice is governed by `/SOUL.md` (binding). Never let ops chatter
(see `automations/shared/ops-voice.md`) leak into `drafts/` or published copy.

## Layout

```
content/
  personas/            # writer character sheets (byline identity + avatar spec)
  research/
    inspiration/       # trend-researcher: inspiration packets
    trends/            # trend-researcher: trend briefs
    sources/           # reusable source records (feed notes, trusted outlets)
  ideas/
    inbox/             # raw pitch candidates
    accepted/ rejected/ deferred/
  briefs/
    ready/             # writer-ready briefs
    assigned/          # brief picked up by a writer
  drafts/              # article drafts in progress
  staged/              # local-preview staging receipts
  published/           # production publish handoffs + receipts
  homepage/            # editor-owned featured manifest + apply receipts
  media/
    library/           # library-first image store
      artists/ festivals/ venues/ generic/
  feedback/
    incoming/          # owner Keep/Tweak/Reject records land here
    routed/ archived/  # retrospective moves them through
  ARTICLES_LOG.md      # dedupe ledger (secondary; primary check is the BlogPost table — D5)
  learn/ photo-journal/  # pre-existing workspaces (not part of the article loop)
```

## Status flow (front-matter `status`)

`research → candidate → brief (writer_ready) → draft (needs_editor_review → editor_approved) → local_preview → daily bounded production`

## Conventions

- **Dedupe (D5):** before pitching or publishing, check the live `BlogPost` table (title/slug) first — it holds the 4,000+ imported archive — then `ARTICLES_LOG.md` as a fast secondary ledger.
- **Bylines:** every automated post publishes under a persona in `personas/`, never the house "DJVibe" author. Profiles live at `/team/{username}` (D9).
- **Homepage:** `content-editor` chooses the ordered hero + three supporting
  stories in `homepage/featured.yml`; `content-publisher` applies it locally.
  The separate daily production runner promotes changed approved curation
  after all four selected stories are live. The publisher never chooses the
  stories.
- **Covers are mandatory:** `content-media` processes up to five missing-cover
  items per run, including already-staged local previews. It searches the
  complete local artist-master archive plus owned galleries/article covers
  first, matching profile/gallery/release/track imagery to the actual story.
  Only then does it stage a fresh verified Spotify image or visually reviewed
  Google-first web candidate. `needs_image` is a retryable blocked state;
  publisher staging and production export accept only `media_status: ready`
  with a valid cover.
- **Story shape controls length:** briefs declare `news`, `analysis`, `feature`,
  or `service`. There is no minimum-length padding and no mandatory subhead or
  pull-quote. `/SOUL.md` compression rules and the editor's human-cadence gate
  apply before media or staging.
- **Local artist context before broad research:** for artist-led signals,
  `content-trend-researcher` runs
  `php artisan djvibe:artist-research-context "<exact artist>" --json` for up to
  three primary artists. The read-only result supplies canonical profile and
  archive links, source-labelled biography context, provider releases/tracks,
  related local profiles, snapshot freshness, and artist-library image paths.
  It narrows research but never replaces corroboration or creates ranking copy.
- **Weekly quality tuning:** Sunday's `content-loop-retrospective` compares up
  to 20 recent automation bodies with up to 50 mirrored source articles,
  measures cadence/length/structure/stock phrasing and cover-source fit, and
  folds back at most one recurring house lesson. It may requeue at most two
  explicit production-pending local previews; production-published rewrite
  candidates require an owner proposal.
- **Spotify discovery:** when an article artist is absent from the local chart,
  an exact unique Spotify search result can be added and hydrated with
  `djvibe:discover-spotify-artist`, expanding both the chart roster and the
  verified artist-photo pool. Event and festival drafts carry a sourced
  `artists` lineup list; `djvibe:discover-event-artists <draft>` attempts the
  whole list locally, and production promotion repeats the idempotent attempt
  against the live roster. Ambiguous matches require review.
- **No em dashes, one `!` per article max** (`/SOUL.md`).
