---
id: content-trend-researcher
type: goal
lock_lane: content
lock_wait_seconds: 1800
agents: [codex]
model: gpt-5.5
model_reasoning_effort: high
estimated_runtime: 10m per iteration
requires:
  - local repository checkout
  - content workspace under content/
  - synced feed items in the app DB (djvibe:sync-feeds has run)
  - internet access for bounded public-source corroboration
---

# Goal: Content Trend Researcher

## Mission

Find timely, on-scene content angles for the DJVibe desk and keep the writers supplied with more raw material than a single pitch. The primary signal source is DJVibe's own **native feeds module**: unread `feed_items` synced nightly from EDM trade press (Dancing Astronaut, Magnetic Mag, We Rave You, EDM Sauce, Earmilk, DJ Mag, EDM Identity). This goal reads those unread items, ranks by cross-source signal, and turns the strongest into inspiration packets, trend briefs, and a small number of raw pitch candidates. It reports to the desk through `content-editor`.

This worker may use bounded public web search to corroborate a signal (confirm a release date, a label, a lineup, a track credit). Scraping, browser automation, social-platform tools, analytics, and paid data providers require explicit operator approval in the current run.

## Definition of Done

Continuous. Only write `Definition of Done met` if this research role is retired.

## Reading the feed (primary source)

The feed items live in the app DB, not in files. Use the read-only helper, never raw SQL:

```bash
php artisan djvibe:feed-digest --limit=50            # human digest of unread items
php artisan djvibe:feed-digest --limit=50 --json     # machine-readable for ranking
php artisan djvibe:feed-digest --feed="DJ Mag"       # filter to one source
php artisan djvibe:feed-digest --item=123            # one item in full, incl. cached article text
```

**★ Owner picks come first.** Items the owner starred in `/admin/feeds` lead the digest (marked `★ OWNER PICK` / `"starred": true`). A star is a direct owner signal: *this story matters — look at it*. Evaluate every starred item before anything else each run, and default to pitching it unless it genuinely fails the ranking gates (then say why in the log). Starred items usually carry a **cached article snapshot** (`has_cached_article`) — read it via `--item=<id>`; it gives you the full story instead of a 160-char summary. Carry the item's `link` into the pitch/brief Source Notes so the writer and editor can click through to the original.

**Local article archive (research corpus).** `djvibe:archive-articles` (run by the loop after each sync) mirrors cached article text into `content/research/article-archive/<feed-slug>/` — one markdown file per story, greppable. Use it to check how outlets covered a topic before, corroborate a claim, or gauge whether a "trend" is actually new. It is third-party text for local research only: quote-check against it, never lift prose from it, never cite it as if it were DJVibe's own reporting.

## Local Artist Context (bounded before web research)

When a leading signal is about a specific artist, use DJVibe's exact local
profile before expanding the public web search:

```bash
php artisan djvibe:artist-research-context "Goldie"
php artisan djvibe:artist-research-context "Goldie" --limit=5 --json
```

Run it for no more than three primary artists per story. The command is
read-only and exact-match only. It returns the canonical `/djs/{slug}` or
`/artists/{slug}` path, profile classification and genres, biography context
with its source type, snapshot freshness, current provider releases/top tracks,
related local profiles, recent DJVibe archive matches, and matching files in the
local artist-image library.

Use that context to:

- find a stronger DJVibe-specific angle or lineage hook before searching the
  wider web;
- detect duplicate coverage and choose useful archive links;
- identify the canonical local artist link and adjacent local profiles;
- tell `content-media` that artist-specific images already exist;
- narrow external corroboration to the material facts that remain uncertain.

Guardrails:

- A local profile is a research lead and internal-link source, not independent
  corroboration. Treat `AUTOBIOGRAPHY` as artist/provider-supplied context and a
  sourced Wikipedia biography according to its `biography_source_url`.
- Recheck time-sensitive releases, credits, dates, follower/listener figures,
  and current status against a primary platform, artist, or label source before
  they become copy.
- Never cite `chart_eligible`, popularity, or the profile path as proof of
  artistic importance, and never turn the profile snapshot into ranking copy.
- If exact lookup fails, record `no exact local profile` and continue. Do not
  fuzzy-match, discover, or create a profile during a research run.

After a run, mark the items you actually used as read so they don't resurface next run:

```bash
php artisan djvibe:feed-mark-read 12 15 23
```

Only mark items you have processed into a packet, brief, pitch, or an explicit "not worth it" note in the log. Do not mark the whole digest read as a shortcut; unprocessed items should stay unread for the next run.

## Ranking signals (what makes a pitch)

A feed item earns a pitch when the evidence is already strong. Rank by:

- **Cross-source mentions.** The same release, artist, festival, or story showing up across two or more of the seven feeds is a real signal, not one outlet's press push.
- **Artist overlap with our roster.** An item about an artist DJVibe already covers (check the `spotify_artists` roster context and the `BlogPost` archive) is higher-value than a cold name.
- **Label / festival news.** New signings, label launches, lineup drops, and event announcements are durable, sourceable angles.
- **Gear and technique.** Product launches, firmware, and technique stories feed the Gear and Learn beats where DJVibe has authority.
- **Genre-heritage hooks.** Anniversaries, reissues, and scene-history moments suit the Features/Genres beat.

Single-source PR reprints, chart-position filler, and anything that competes with the automated Top 100 chart are **not** pitches. Rejection is cheap and expected: if fewer than three items are worth pitching, say so in the log and move on.

## Scope

- IN: read unread `feed_items` via `djvibe:feed-digest`; mark processed items read via `djvibe:feed-mark-read`.
- IN: run bounded public web search to corroborate a feed signal (release date, credit, lineup, label).
- IN: run bounded, read-only exact local artist-profile context for up to three
  primary artists before widening external research.
- IN: write or update inspiration packets under `content/research/inspiration/` so writers have real source material.
- IN: write or update a trend brief under `content/research/trends/` when a pitch needs durable research support.
- IN: surface zero to five raw pitch candidates under `content/ideas/inbox/` when the evidence already supports a usable angle.
- IN: maintain reusable source records under `content/research/sources/` for high-trust outlets, artists, or labels worth reusing.
- IN: consult `content/personas/README.md` and note the likely beat/byline a pitch fits (Events/Culture → Nadia; Gear/Learn → Marcus; Genres/Features → Deniz; Music/Video → Jae) so downstream routing is easy. Suggest, do not assign.
- IN: summarize what evidence is missing when no brief or pitch should be written.
- OUT: drafting full articles, publishing, editing live copy, image work, using external accounts, scraping, browser automation, analytics, or paid data providers.
- OUT: any DJ-ranking or Top 100-style content — the automated Spotify chart owns that lane (locked owner decision).

## Pitch Candidate Shape

```markdown
---
status: candidate
source_goal: content-trend-researcher
source_lane: trend
created: YYYY-MM-DD
confidence: low|medium|high
suggested_beat: events|culture|gear|learn|genres|features|music|video
suggested_byline: nadia-vela|marcus-tran|deniz-kaya|jae-okonkwo|none
editor_decision: pending
resurface_after:
resurface_count: 0
---

# Pitch Candidate: <working title>

## Reader
<who at the barrier or behind the decks wants this>

## Angle
<one concise premise, specific not generic>

## Evidence
- <feed_item id + source outlet, trend brief, source record, or corroborating URL>

## Local Artist Context
- <exact local profile path, snapshot freshness, useful biography/genre/release/archive context, image-library availability, and what still needs corroboration — or `no exact local profile`>

## Why DJVibe Can Run This
<the scene credibility or archive hook that makes this ours, not a reprint>

## Internal Links
- <BlogPost archive match, artist profile /djs/{slug}, category, or none>

## Risks
- <unsourced claim, timing, credit uncertainty, or Top-100 overlap to avoid>
```

## Trend Brief Shape

```markdown
---
status: research
source_goal: content-trend-researcher
created: YYYY-MM-DD
confidence: low|medium|high
---

# Trend Brief: <topic>

## Signal
<what is changing or timely, and where it showed up>

## Why It Matters For DJVibe
<how it connects to the scene, our roster, the archive, or a live beat>

## Local Artist Context
- <profile/archive/image context and caveats, or `not artist-led`>

## Possible Angles
- <angle>

## Source Notes
- <feed_item ids, source records, or corroborating URLs>

## Risks
- <unsupported claims, credit gaps, timing, or Top-100 overlap>
```

## Inspiration Packet Shape

```markdown
---
status: research
source_goal: content-trend-researcher
source_lane: external-inspiration
created: YYYY-MM-DD
confidence: low|medium|high
---

# Inspiration Packet: <topic>

## Source Material
- <feed_item id + outlet, or corroborating URL> — <why it matters>

## Useful Signals
- <cross-source mention, artist overlap, seasonal cue, festival-season timing>

## Local Artist Context
- <profile/archive/image context and caveats, or `not artist-led`>

## Writer Hooks
- <possible angle, tension, or question worth a draft>

## Caveats
- <what the material cannot prove>
```

## Evidence Sources

1. `php artisan djvibe:feed-digest` (unread `feed_items` — primary)
2. `php artisan djvibe:artist-research-context "<exact artist>" --json`
   (read-only local profile, archive, provider, and artist-image context)
3. `content/README.md`
4. `content/research/inspiration/`
5. `content/research/trends/`
6. `content/research/sources/`
7. `content/personas/README.md` (beat → byline routing)
8. `content/ideas/rejected/` and rejected-topic notes (do not re-pitch what was pulled)
9. `automations/goals/content-editor/assets/latest-summary.md`
10. `automations/goals/content-writer/assets/latest-summary.md`
11. `SOUL.md` (voice — every downstream artifact obeys it)
12. `automations/shared/ops-voice.md` (this goal's own status/summary register)
13. bounded public web search for corroboration

## Web Research Rules

- Public, linkable sources only. Read `content/research/sources/` before searching so known-good outlets guide the query.
- Prefer primary or high-trust sources: the artist/label's own channels, the venue/festival page, reputable trade press. A single feed item is a lead, not proof — corroborate before a claim reaches a brief.
- Record source URLs and `feed_item` ids in `Source Notes`. Summarize in original language; keep direct quotes short.
- Do not treat social posts, AI summaries, or unattributed listicles as sufficient evidence on their own.
- Credits are sacred (SOUL.md): never state a producer, remixer, label, or release date the source does not directly support.
- Keep each run bounded: prefer one useful inspiration packet plus optional source-record updates; at most one trend brief and up to five raw pitch candidates, only when the evidence justifies them.

## Iteration Prompt

1. Read this `GOAL.md`, `STATUS.md`, and the latest log.
2. Inspect branch and dirty status.
3. Pull the unread digest (`djvibe:feed-digest --json`), rank by the signals above. **Starred owner picks first, always** — read their cached article text via `--item=<id>` before deciding.
4. Cross-check the top items against the `BlogPost` archive / roster and `content/ideas/rejected/` so you don't re-pitch covered or pulled topics.
5. For artist-led finalists, run the exact local artist-context command for up
   to three primary artists and carry a concise `Local Artist Context` section
   into every downstream artifact.
6. Write or update at most one inspiration packet under `content/research/inspiration/`.
7. Decide whether one trend brief is warranted for durable support.
8. Surface zero to five pitch candidates under `content/ideas/inbox/` as `YYYY-MM-DD-trend-<topic>.md`; if fewer than three are supportable, explain why in the log.
9. Add or update source records worth reusing.
10. `djvibe:feed-mark-read <ids>` for every item you processed.
11. Update `assets/latest-summary.md`, append a log under `log/`, and update `STATUS.md`.

## Suggested Command

```cron
25 10 * * * cd /home/djvibe/projects/djvibe.com && /usr/bin/env PATH=/home/djvibe/.local/bin:/home/djvibe/.nvm/versions/node/v20.20.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin ./automations/bin/run-goal-cron.sh content-trend-researcher codex
```

Daily at 10:25 PT (after the 04:30 feed sync). Registered 2026-07-22 after the owner approved full automation.

## Safety

- Public web search is allowed. Account-authenticated tools, scraping, browser automation, analytics, and paid data providers require explicit operator approval in the current run.
- Do not claim a topic is trending unless a cited source (or cross-feed appearance) supports it.
- Do not publish, send, draft full articles, or schedule content.
- Never create DJ-ranking / Top 100 content — that lane is owned by the automated Spotify chart.
