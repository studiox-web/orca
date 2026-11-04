# Cascade/XOS Automation Framework → Orca: Gap Analysis & Expansion Plan

Status: plan v3.3 (2026-11-04), interview complete; §3g queues and §3h PM view (Tasks) added. All queues and items live in the Orca project home.
**Implemented on `xos`: see §4a for what exists, what is reachable, and what is left.** Source is verified by unit tests only: nothing after `e73872c0d9` has been built, installed or live-tested. `xos/audit-ledger-5716fed3b9.md` tracks every audit finding.
Related: the `xos` branch already adds a read-only **crontab external manager** that enriches `run-goal-cron.sh` jobs with JSONL receipts (`src/main/automations/external-crontab-*.ts`), plus fork build and switch scripts.

## 0. Direction

1. **First, expand Orca's automation core** until it can run what Cascade runs today.
2. **Then migrate goals to "Orca Goals"**, a first-class goal entity built on top of Orca automations.
3. Cascade (`~/projects/CascadeWellness/automations`, plus the Command Centre) is the reference implementation. djvibe and studiox are copies. djvibe stripped out the employee-media and studio code (commit 2026-07-18).
4. `~/projects/xos` (a Laravel control plane, phases 0–6, runtime never enabled) designed the multi-project layer: projects, modules, teams, loops, focus sprints, budgets, approvals, and versioned definitions. We reuse its concepts and drop the separate app.

Every core change goes into isolated `xos-*`/`goal-*` modules on the `xos` branch, so rebases on upstream (about 2k commits a week) stay mechanical.

## 1. What Orca already covers

| Cascade feature                                       | Orca today                                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Schedules (crontab)                                   | ✅ RRULE + timezone + missed-run grace (better than cron)                                              |
| Preflight scripts (`run-content-writer-cron.sh` etc.) | ✅ `precheck` command (non-zero exit = skip)                                                           |
| Run in the repo checkout                              | ✅ `workspaceMode: existing`; per-run worktrees are also possible                                      |
| Manual "run now"                                      | ✅ UI + `orca automations run`                                                                         |
| Run history                                           | ✅ per run: status, output snapshot, terminal/chat link                                                |
| Per-run tokens and cost                               | ✅ Claude and Codex (`AutomationRunUsage`, API-equivalent cost)                                        |
| Live tail of a running job                            | ✅ better: the run _is_ an Orca terminal or chat you can open                                          |
| Provider quota windows (the token-maxxing page)       | ✅ `RateLimitService`: real 5h and weekly windows for Claude, Codex, Gemini/Antigravity, Grok, Cursor… |
| Multi-account                                         | ✅ Claude, Codex and Grok account registries                                                           |
| Log retention / pruning                               | ✅ run retention                                                                                       |
| Doc and log viewers                                   | ✅ Orca editor and markdown preview (needs deep links only)                                            |
| GitHub issue intake                                   | ◐ Orca task sources (GitHub/Linear/Jira) exist; our classify→route→label→close loop does not           |
| Deterministic crons (deploy, backups, spotify)        | ◐ read-only on the `xos` branch (crontab manager)                                                      |

### About "select a fallback model"

Orca has no fallback field in the automation editor. The closest option is typing Claude's own `--fallback-model sonnet` into **Extra arguments**. That flag covers only Claude → Claude when a model is overloaded or unavailable. It does not trigger on usage or spend limits, and it cannot cross providers. §3 replaces it with a **model picker + fallback list + Auto mode**, built from the same live model catalog the chat picker uses.

## 2. Full gap list

Legend: **G** = gap in Orca, **P** = partial, ✅ = covered. _Size_: S < 1 day, M = 2–4 days, L = 1–2 weeks.

### 2.1 Runtime (needed before any goal can move)

| #    | Cascade behaviour                                                                                                                                                                               | Source                                     | Orca                                                                                               | Size                |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------- |
| RT1  | **Structured model + reasoning effort per goal** (`model`, `model_reasoning_effort` frontmatter → `-m`/`--model`, `-c model_reasoning_effort` / `--effort`)                                     | `run-goal.sh`                              | P: free-text `extraAgentArgs` only                                                                 | S                   |
| RT2  | **Allowed agents list** (`agents: [codex, claude]`); an unlisted agent request is rewritten to the first allowed one                                                                            | `run-goal.sh`                              | G: single `agentId`                                                                                | S                   |
| RT3  | **Prompt assembly**: GOAL.md + `@shared/...` includes + STATUS + latest log (byte-capped) + **open inbox messages injected**, sent over stdin                                                   | `run-goal.sh`, `expand-includes.sh`        | G: static prompt text                                                                              | M                   |
| RT4  | **Limit classification**: non-zero exit + limit/auth patterns; **exit 0 with ≤25 lines that is only a limit banner**; missing binary. Real failures never fall back                             | `run-goal.sh` 280–540                      | G: runs end `completed` or `dispatch_failed`; no "agent failed / limited" outcome and no exit code | M                   |
| RT5  | **Fallback chain with tier mapping** (gpt-5.5↔opus↔gemini-3.1-pro, mini↔sonnet↔flash, spark↔haiku↔flash), env overrides, never for inbox-only runs, Ollama banned                               | `run-goal.sh`, `run-task.sh`               | G                                                                                                  | M                   |
| RT6  | **Fallback telemetry**: event log, alert file, per-provider high-water marks used to tune ceilings                                                                                              | `log-agent-fallback.sh`                    | G                                                                                                  | S                   |
| RT7  | **Per-goal lock + lane lock** (`lock_lane`: repo-mutating, content, deploy, db-media, photo, dm, ops-status, platform-ops, ops-director) **with `lock_wait_seconds` queueing** (otherwise skip) | `run-goal-cron.sh`                         | G: no concurrency control at all                                                                   | M                   |
| RT8  | **Serialized auto-commit / auto-push** scoped to the goal's `owned_paths`, plus a global `git-commit.lock`                                                                                      | `commit-automation-changes.sh` (439 lines) | G: no post-run hook                                                                                | M                   |
| RT9  | **Run modes per goal**: normal iteration vs **inbox-only "reply" run** (cheap model `gpt-5.4-mini`/low, `dm` lane, no fallback, no commit)                                                      | `CASCADE_GOAL_INBOX_ONLY`                  | G                                                                                                  | S                   |
| RT10 | **Sidecar / off-cycle contracts**: alternate prompts for a goal (employee photoshoot, photo-journalist video, pitch pack, proposal pack)                                                        | `sidecars/*.md`                            | G: one prompt per automation                                                                       | S (once RT3 exists) |
| RT11 | **Event triggers**: every-minute inbox scan starts goals with open messages (max N per tick)                                                                                                    | `run-inbox-watch.sh`                       | G: schedule or manual only                                                                         | M                   |
| RT12 | **Run with a message** from the dashboard ("tell goal X to do Y now")                                                                                                                           | `runBackgroundAutomation`                  | G                                                                                                  | S                   |
| RT13 | **Nested runs**: a manager starts a child goal through the locked wrapper                                                                                                                       | `AGENTS.md`                                | P: CLI exists; locks are not inherited                                                             | S                   |
| RT14 | **Definition of Done stop**: a goal stops itself when STATUS contains the literal string                                                                                                        | `AGENTS.md`                                | G: needs "auto-disable on condition"                                                               | S                   |
| RT15 | **Run timeouts** (`estimated_runtime`)                                                                                                                                                          | frontmatter                                | verify; likely G                                                                                   | S                   |
| RT16 | **Routines and one-shots** (`run-task.sh`)                                                                                                                                                      |                                            | ✅ as plain automations                                                                            |
| RT17 | **Deterministic shell jobs** run _by_ Orca (not just listed)                                                                                                                                    | crontab                                    | G (read-only on `xos`)                                                                             | M                   |

### 2.2 Goal state and memory (the "Orca Goals" entity)

| #   | Cascade behaviour                                                                                                                                                                                                                          | Orca                          | Size |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- | ---- |
| GS1 | Goal folder: `GOAL.md` (contract), `STATUS.md` (cold-resume state), `MEMORY.md`, `SOUL.md` (voice only), `LESSONS.md`, `DECISIONS.md`, append-only `log/`, `assets/`, `pitches/`, `state/`                                                 | G: no goal entity             | L    |
| GS2 | **Parsed STATUS fields** shown on the dashboard ("Status Fields"), contract status (`Definition of Done met`, active…)                                                                                                                     | G                             | S    |
| GS3 | **`admin_summary`**: a 1–2 sentence operator summary per run (log frontmatter or `## Admin Summary`)                                                                                                                                       | G: only a raw output snapshot | S    |
| GS4 | **Templates**: `_template/goal.md`, `routine.md`, `one-shot.md`, `prompts/create-goal-contract.md`, `create-manager-role.md`, and the People-Ops onboarding checklist                                                                      | G: no "hire a role" flow      | M    |
| GS5 | **Shared contracts** (`shared/*.md`: safety checklist, voice, editorial exemplars, manager↔director messaging)                                                                                                                             | G (part of RT3)               | —    |
| GS6 | **Org metadata**: area (C-suite, Platform Ops, Feature Dev, Listings, Marketing, Sales, Host Success, Guest Support, Special Projects, People Ops, Data, Legal), manager per area, title, sort order. _Currently hard-coded PHP constants_ | G                             | S    |
| GS7 | **Subagents metadata** (`subagents`, `subagent_mode`) → card badges and "heavy" warnings                                                                                                                                                   | G                             | S    |

### 2.3 Messaging: external, not built into Orca

Decision (2026-11-02): **no native messaging UI in Orca core.** The operator will talk to the system through a **Grok bot or OpenAI agents** (and Slack/WhatsApp in front of those). Orca's job is to give those agents **complete read/write access through the CLI (and RPC)**. An optional Orca _plugin_ panel can be added later if an in-app view is wanted.

| #   | Cascade behaviour                                                                           | Where it goes                                                                                                                                                                              | Size |
| --- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| MS1 | Operator → goal **inbox** messages (from/to/priority/status, read receipts, `responded_at`) | Keep the **file format** in `goals/<g>/inbox/`. Add `orca goals message <goal> --body/--file [--attach …] [--run-now]`, which writes the file and optionally starts a reply run (RT9/RT12) | S    |
| MS2 | Goal acknowledges, then responds in its SOUL voice; message moves to `processed/`           | Unchanged agent convention (needs RT3/RT9)                                                                                                                                                 | —    |
| MS3 | Attachments                                                                                 | `--attach` copies files into the inbox folder                                                                                                                                              | S    |
| MS4 | Threaded chat-bubble view, counts, card inbox badge                                         | Bot renders threads from `orca goals messages <goal> --json`. The card still shows an inbox count badge (UI7)                                                                              | S    |
| MS5 | Goal ↔ goal messages (manager → director)                                                   | Same CLI, called by agents                                                                                                                                                                 | —    |
| MS6 | WhatsApp relay with voice transcription                                                     | Replaced by the Grok/OpenAI bot front-end, or keep the sidecar writing inbox files                                                                                                         | —    |
| MS7 | Agents DM the operator unprompted                                                           | `orca goals notify --goal <g> --text … [--image …]` → outbound queue file + Orca notification. The bot polls (or tails `--json --follow`) and relays to Slack/WhatsApp                     | S    |

### 2.3a Agent-facing API: the CLI is the API

What a Grok/OpenAI operator bot needs, all with `--json`:

| Command                                                              | Returns / does                                                                                              | Exists?                   |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------- |
| `orca automations list / show / runs / run`                          | Definitions, run history, trigger a run                                                                     | ✅                        |
| `orca goals list`                                                    | Every goal with area, manager, status, last/next run, admin_summary, inbox count, health                    | G                         |
| `orca goals show <goal>`                                             | Contract summary, STATUS fields, recent runs with model, fallback hops, tokens and cost, latest log excerpt | G                         |
| `orca goals message / messages / notify`                             | §2.3                                                                                                        | G                         |
| `orca goals run <goal> [--mode reply\|sidecar:<name>] [--message …]` | Run variants                                                                                                | G                         |
| `orca goals pause/resume <goal\|area\|project>`                      | Hierarchical pause (PF2)                                                                                    | G                         |
| `orca usage limits`                                                  | Live `RateLimitService` windows per provider and account                                                    | G (RPC exists internally) |
| `orca usage summary --since 7d [--by goal\|model]`                   | Analytics rollup (OV3)                                                                                      | G                         |
| `orca models list [--agent …]`                                       | Live catalog + tier map (for the bot to answer "what's running on what")                                    | G                         |
| `orca goals briefing`                                                | TLDR: action-needed items, failures, fallbacks, open decisions (OV1)                                        | G                         |

Transport: the bot runs on this machine, or reaches it over SSH, and shells out to `orca`. If a network endpoint is needed later, put a thin authenticated HTTP or MCP wrapper over the same commands. This requires no core change.

### 2.4 Operations dashboard: the cards

| #   | Cascade behaviour                                                                                                                                                             | Orca | Size |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- |
| UI1 | **Trading-card identity registry** per goal: display name ("Aster Vane, Neon Regent"), persona, flavour description, art prompt (`automation-card-identities.ts`, 1.4k lines) | G    | M    |
| UI2 | **3 card themes** (noir / corporate / retreat) × light/dark art + avatars: **320 images** under `public/images/admin/ops-cards/`, with fallback image chain; choice persisted | G    | M    |
| UI3 | **Casting-cost pips**: provider icons (Claude/Codex/Antigravity) plus cost tier from tokens                                                                                   | G    | S    |
| UI4 | **Power/toughness**: model strength 0–10 and reasoning depth 0–10                                                                                                             | G    | S    |
| UI5 | **Run meter**: last-N run bars, latest-run tone, **streak effects** (locked-in, warning streak, fire streak)                                                                  | G    | S    |
| UI6 | **Rank styling**: C-suite **foil**, manager shield, crown icon                                                                                                                | G    | S    |
| UI7 | Card badges: open inbox count, subagent count; spinning **live-tail button** for running jobs                                                                                 | G    | S    |
| UI8 | **Operations views**: business-area grid **vs. org chart** (expand/collapse hierarchy), filters (attention, healthy, messages…), "showing N of M"                             | G    | M    |
| UI9 | Area health badge per business area                                                                                                                                           | G    | S    |

#### Porting the card look and feel (verdict: keep essentially all of it)

- **Same stack.** Cascade uses Tailwind 4, shadcn `new-york`, and CSS variables with `color-mix(in oklab…)`. So does Orca (`components.json`, `src/renderer/src/assets/main.css`), and Electron's Chromium supports all of it.
- **Self-contained styles.** The card styles are about 800 lines in Cascade `resources/css/app.css` (lines 181–978). The selectors are `.ops-spell-*`, `.c-suite-foil*`, `.ops-run-meter*` and `.ops-goal-*`, with 6 keyframes: foil sheen, hover sheen, icon pulse, meter charge/caution/fire. Reduced-motion handling is already in place. They copy over as a single `ops-cards.css`.
- **Palette.** The cards are tinted through `--primary/--card/--secondary`. Inside Orca those come from the active Orca theme, so the cards would lose Cascade's teal and sand. Fix: a `.ops-cards` wrapper that re-declares Cascade's oklch tokens for light and dark (primary `oklch(0.395 0.088 221)` / dark `oklch(0.7 0.13 192)`, secondary sand `oklch(0.932 0.024 85)`). Optionally offer a "follow Orca theme" switch.
- **Logic.** `automation-card-identities.ts`, the card component, pips, power/toughness, run meter and streak logic port as-is. Only the glue changes: Inertia `Link`/`usePage` → Orca navigation; Laravel payload → the Orca goal and run model.
- **Art.** 320 images (12 MB) plus provider icons: ship them as the bundled default deck, with per-project overrides in a project folder. New goals have no art yet, but every identity already has an `artPrompt`, so add a "generate card art" sidecar run (Codex imagegen / Grok imagine).
- **Font.** Cards use Satoshi. Bundle it scoped to the cards, or accept Orca's font.
- **Orca-specific care.** Orca stays open all day, so pause infinite animations (foil, icon pulse) when the board is off-screen or the window is hidden. Use Orca's light/dark state to choose the card image mode.

### 2.5 Goal detail page

| #   | Cascade behaviour                                                                                                                                                                                                                       | Orca                                                    | Size |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---- |
| GD1 | Facts: model, reasoning, runner, cron schedules, contract status, status-updated time, subagents, goal/status/log file links                                                                                                            | P: Orca detail has schedule, agent, args, usage         | S    |
| GD2 | Recent runs with exit code, duration, failure reason, model per run                                                                                                                                                                     | P: no exit code, no failure reason, no effort           | S    |
| GD3 | Usage: 7d (runs, tokens, max run tokens and cost, model) and 30d (runs, tokens, cost, models used)                                                                                                                                      | P: per-run only                                         | S    |
| GD4 | Goal logs list with first line and a prev/next log viewer                                                                                                                                                                               | G                                                       | S    |
| GD5 | **Codex / Grok action panel**: open an _interactive_ agent terminal pre-loaded with a goal-scoped prompt                                                                                                                                | P: trivial in Orca (it is the launcher); needs a button | S    |
| GD6 | **Special Projects dashboard**: project docs with status, approval, risk, owner, next action, recommendation, open questions, approval gates, analysis/feature-ready flags, research mode (direct/analyst), progress tracker, artifacts | G                                                       | M    |
| GD7 | SOUL notes excerpts (persona voice)                                                                                                                                                                                                     | G                                                       | S    |

### 2.6 Employee media and personas (cut from djvibe, live in Cascade)

| #   | Cascade behaviour                                                                                                                                   | Orca                                     | Size |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ---- |
| EM1 | Per-employee **reference gallery** and **photoshoot gallery** (originals/gallery/thumbs), 63 MB across goals                                        | G                                        | M    |
| EM2 | **Review workflow**: accept/reject with reason and timestamp; accepted images become identity references                                            | G                                        | S    |
| EM3 | Upload or remove references; **photoshoot prompt builder** (employee picker, listing picker with amenities, _Maya_ pose builder and outfit builder) | G (listing pickers are Cascade-specific) | M    |
| EM4 | **Video gallery** (Grok `imagine-video` sidecar, posters)                                                                                           | G                                        | S    |
| EM5 | **Photo journal** gallery with pagination and review badges (58 MB, Maya River persona)                                                             | G                                        | M    |
| EM6 | Image generation runs as a **sidecar run** of the goal (Codex `imagegen` skill or Grok)                                                             | G (RT10)                                 | —    |

### 2.7 Command Centre overview, pipelines and analytics

| #   | Cascade behaviour                                                                                                                                                                                                            | Orca                                                                      | Size              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------- |
| OV1 | **AI TLDR banner** (`operator-tldr-summary`, `cascade:dashboard:refresh-summary`): Action Needed / Watch / Healthy / No Signal, stale detection when a newer run exists, refresh button                                      | G                                                                         | S                 |
| OV2 | **Jobs board**: running (pid), _Up next_ across all goals, schedules, previous runs, merged duplicate rows, tail with bullet summary                                                                                         | P: Orca runs table; no cross-automation "up next" timeline                | S                 |
| OV3 | **Analytics**: runs today/week/month, success rate, tokens and cost windows, **cost per completed feature**, daily token trend, cost by goal, run outcomes, feature velocity, funnel, most expensive runs, goal-health table | P: per-run data exists; no rollups                                        | M                 |
| OV4 | **Token-maxxing forecast**: burn rate, projected % at reset, time to target, target utilization (95%)                                                                                                                        | P: Orca has live windows; no burn-rate forecast or "fill the plan" target | S                 |
| OV5 | **Pending decisions / operator mandates** (`GITHUB_ISSUES.md`, `DECISIONS.md`) and recent commits                                                                                                                            | G: approvals concept                                                      | M                 |
| PL1 | **Feature pipeline**: planned/completed markdown docs, ready flag, priority, size, rank, estimates, search/sort                                                                                                              | G                                                                         | M                 |
| PL2 | **Bug pipeline**: incoming / fixed / QA inbox / QA resolved                                                                                                                                                                  | G                                                                         | S (generic board) |
| PL3 | **Content pipeline**: research (trends, marketplace, sources) → ideas (inbox/accepted/rejected) → briefs (ready/assigned) → drafts → published                                                                               | G                                                                         | S (generic board) |
| PL4 | GitHub sync: classify issue → route to feature/bug/feedback folders, labels, hidden processed marker, **close the issue when its feature doc completes**                                                                     | P                                                                         | M                 |

PL1–PL3 are all "folders of markdown with frontmatter, shown as columns". The folders also drive _when_ goals run; see §3g. One generic **Queue Board** (config: columns = folders, card fields = frontmatter keys) covers all three, plus djvibe's content and festival queues.

### 2.8 Portfolio layer (designed in XOS, never built)

| #   | XOS concept                                                                                                                  | Notes                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| PF1 | Multiple projects in one control plane, with locks, budgets and history namespaced per project                               | Orca already has multiple repos; lanes need a project scope |
| PF2 | Project modes: focus / active / maintenance / paused; **hierarchical pause** (project → loop → goal), pause-after-run, drain |                                                             |
| PF3 | **Focus sprints** and capacity profiles (focused / balanced / expanded) with an operations reserve                           |                                                             |
| PF4 | **Token budgets and reservation** per project/loop, with fallback charged to the right budget                                | Builds on RateLimitService                                  |
| PF5 | **Approvals** (e.g. migrations need sign-off; deploy gates)                                                                  | Overlaps OV5                                                |
| PF6 | **Immutable, versioned definitions** (content hash in every run receipt)                                                     | Orca stores the prompt; add version and hash                |
| PF7 | Cutover safety: disable the legacy owner before enabling the replacement, with a fingerprint                                 | Needed for our own migration                                |

## 3. Model selection, fallback and "Auto" (core)

### 3.1 What we can reuse

- **Live model catalogs**: Orca already asks each CLI for its model list (`src/main/claude/claude-model-catalog-probe.ts`, `src/main/codex/codex-model-catalog-probe.ts`, ACP probes for Grok and Gemini, `agent-model-catalog-store`). This is the list behind the native-chat model picker (`NativeChatModelCombobox.tsx`). **This solves "keep the list updated"**: new models appear when the CLI ships them, with no list for us to maintain.
- **Typed usage-limit events**: structured (chat-surface) sessions already report `AgentSessionUsageLimit { window: session|weekly|weeklyModel|credits, resetsAt }` and support "continue after reset" (`agent-session-usage-limit-continue.ts`). Automation runs on the **chat surface** therefore get exact limit detection. The text-pattern matching (banner-only exit 0) is only needed for terminal-surface runs.
- **Live quota**: `RateLimitService` reports remaining 5h, weekly and per-model windows per provider and per account.

### 3.2 Editor UI

One **"Model" field in the automation editor**, using the same combobox as the main chat model picker:

```
Model      [ Auto (best fit with quota)        ▾ ]
           ├ Auto
           ├ Claude ▸ Opus 4.x · Sonnet · Haiku · Fable          ← live catalog
           ├ Codex  ▸ gpt-5.5 · gpt-5.4-mini · gpt-5.3-codex-spark
           └ Gemini ▸ 3.1 Pro · 3.5 Flash          Grok ▸ …
Effort     [ medium ▾ ]   (options follow the selected model's capabilities)
Fallbacks  [ + Add fallback ]  1. Claude Opus · high   2. Gemini 3.1 Pro   (drag to reorder)
           ☐ Try my other accounts first
```

- Choosing a model sets `agentId` + model + effort. This replaces hand-typed `--model` args (RT1, RT2).
- **Fallbacks** reuse the same picker for each entry. If the list is left empty, Orca suggests a chain from the tier map (below).
- **Auto** fills in both the model and the chain at dispatch time.

### 3.3 Auto mode

Each automation states its **tier** (the default is inferred from the current model, or set explicitly: `high` / `standard` / `light`) and optionally its **providers** (allowed providers). At dispatch:

1. Candidates = catalog models in that tier from allowed providers, across signed-in accounts.
2. Drop any candidate whose quota window would be exceeded (`RateLimitService`), with a configurable reserve (e.g. keep 10% weekly for interactive work).
3. Rank by **most remaining quota relative to reset time** ("use the plan that expires soonest"; this is what the token-maxxer goal did by hand), then by preference order.
4. Record _why_ it picked that model on the run ("Auto → Codex gpt-5.5: Claude weekly at 93%").

A **tier map** in Settings assigns each catalog model to a tier, with defaults from §2.1 RT5. It is editable, and unknown new models land as "unassigned" with a badge. This is the only list a person maintains, and only when a new model family appears.

### 3.4 Fallback at runtime

- **Before launch**: Auto mode, or a fixed model whose quota is exhausted, skips straight to the next fallback.
- **During or after the run**: on a typed usage-limit event (chat surface), or a classified limit (terminal surface: limit/auth patterns, banner-only exit 0, missing binary), the run ends `limited`. A linked retry starts with the next candidate (`parentRunId`, `fallbackFrom`, `fallbackReason`). Real task failures never fall back.
- Per-automation option _"wait for reset instead"_. It uses the existing continue-after-reset mechanism, which suits jobs that must stay on one model.
- Off for reply runs and manual runs unless opted in.
- The run record carries the events (replaces the jsonl and alert files), an Orca notification fires on each hop, and the fallback count shows on the card and in analytics.
- Test fixtures: the real outputs from `state/limit-hits.jsonl`, `agent-fallback-events.jsonl`, and the 2026-06-11 Claude spend-cap banner.

## 3a. Concept: "Build your digital company" (card templates and decks)

Goals are already templates in practice: djvibe and studiox were made by copying Cascade's goals and editing them. The concept makes that copying fun and explicit.

| Concept                   | What it is                                                                                                                                                                                                                                                                                      | Built from                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Card (template)**       | A reusable role: contract skeleton (GOAL.md with `{{project}}`, `{{domain}}` placeholders), default tier, lane, schedule, shared includes, SOUL voice, identity (name, persona, flavour, art prompt, art)                                                                                       | `_template/*.md`, Cascade goals, `automation-card-identities.ts`                             |
| **Hired card (instance)** | A card placed in a project: a real Orca goal with its own STATUS/MEMORY/log, schedule and model                                                                                                                                                                                                 | Orca Goals (stage B)                                                                         |
| **Deck**                  | The set of hired cards in one project = your digital company; the org chart _is_ the deck layout                                                                                                                                                                                                | Areas/managers (GS6)                                                                         |
| **Factions**              | Business areas, each with a colour identity (Platform Ops, Content, Growth, Sales, Feature Dev…)                                                                                                                                                                                                | `OPS_AREAS`                                                                                  |
| **Card rank**             | Worker → Manager (shield) → C-suite (foil)                                                                                                                                                                                                                                                      | Existing styling                                                                             |
| **Cost**                  | What a card spends per run: tier and model, shown as provider pips                                                                                                                                                                                                                              | Existing pips + Auto mode                                                                    |
| **Budget**                | The deck's total quota per day/week. Adding cards beyond the budget warns you ("this deck runs at 130% of your Claude weekly")                                                                                                                                                                  | RateLimitService + PF4                                                                       |
| **Stats and level-up**    | Power/toughness from model and effort; the streak meter; cards earn **experience** from successful runs and lose it on failures; level badges                                                                                                                                                   | Existing meter + run history                                                                 |
| **Packs**                 | Curated starter sets: _Content Studio_ (trend researcher → writer → editor → media → publisher → retrospective), _Dev Shop_ (dreamer → groomer → implementer → QA → deploy → janitor), _Marketplace Ops_ (listings, reviews, host/guest success), _Exec Suite_ (ops director, TLDR, people ops) | Cascade + djvibe goals                                                                       |
| **Hiring**                | "Draw" a card from a pack → a wizard fills placeholders for this repo → preview contract → choose schedule and model (or Auto) → hire                                                                                                                                                           | `prompts/create-goal-contract.md`, `create-manager-role.md`, people-ops onboarding checklist |
| **Custom cards**          | Describe a role in words → an agent drafts the contract, identity and art prompt → art is generated → the card is added to your collection                                                                                                                                                      | People-ops flow + art sidecar                                                                |
| **Collection**            | All cards you own (built-in packs, your own, imported). Export/import a card or a whole deck as a folder or file so others can share decks                                                                                                                                                      | —                                                                                            |

Design notes:

- Keep the naming and visuals **original** (our own terms, frames and art). The trading-card genre is fine, but we don't borrow another game's rules vocabulary or look.
- Data split: **template = versioned, shareable, no runtime state**; **instance = template version + project bindings + state**. When the template updates, the instance gets an "upgrade available" prompt with a diff (this matches XOS's immutable-version idea, PF6).
- Portability check: most Cascade goals are generic once project names are placeholders. Domain-bound ones (BC listing enrichment, Google review scrape, payouts) become project-specific cards, not pack cards.
- Fun must never weaken safety: hiring a card that can deploy, push or touch production shows its authority (lanes, owned paths, approvals) on the card back, and needs an explicit confirm.

Roadmap fit: the template/instance split belongs in **stage B** (cheap if designed in from the start). Packs, the hiring wizard and the collection come after the card board (stage D). Levels and budget warnings come with analytics (stage E).

## 3b. Project switching: "what's running where"

Orca today (`src/renderer/src/components/automations/`):

- The list filter (`AutomationListFilter`) covers **status, last run, agent, host**. There is **no project filter**.
- Project is only a table column. Sorting is name or last run only.
- The runs dashboard filters by host and status only.
- The crontab external manager on the `xos` branch lists jobs from every repo in one flat list.
- Orca already has a small **automation template catalog** (`automation-templates.ts`: name, prompt, schedule preset, agent). It is the natural base for card templates (§3a).

Add (all small; follows the existing host-filter pattern):

1. `projectKeys` in `AutomationListFilter`, with a menu section and pills. Use the existing `getAutomationProjectGroups` / `getProjectIdentityKey`, so multi-host checkouts of one repo count as one project.
2. A **project switcher** at the top of Automations and the card board: _All projects_ (portfolio) or one project (= that deck). It is persisted, and defaults to the repo of the active workspace.
3. **Group by project** toggle for the list (collapsible sections with running/failed counts).
4. A **"Running now" strip** across all projects: project badge + card avatar + elapsed time, click to open the live terminal.
5. Project filter on the **runs dashboard**.
6. Map external crontab jobs to a project via their `cd <repo>` path, so legacy cron jobs show under the right project during migration.
7. CLI: `--project <name|path>` on `orca automations list/runs` and `orca goals …`, so the bot can ask "what's running in djvibe".

### Naming and placement

- **Use Orca's word "project"**, not "company". One project = one org chart. Orca already groups multiple checkouts of a repo into one project (`getProjectIdentityKey`), so `djvibe-bio-fix-working` folds into DJVibe automatically. Top level is **"All projects"**.
- **Everything lives in Orca's Automations section.** Today its views are `'automations' | 'runs' | 'run'` (`automation-page-state.ts`). Add:
  - **Org chart** (new default): the project switcher, then that project's org chart (area grid as an alternative layout). With _All projects_ selected it shows the portfolio tiles; click one to open its org chart.
  - **Goal** (detail): the Goal Viewer. It replaces the plain detail pane for goals; plain automations keep Orca's existing detail pane.
  - **Automations** (existing list, now with a project filter) and **Runs** (existing, with a project filter) stay as the power-user views.
  - **Cards** (later): the template collection and packs for hiring.
- **Portfolio tiles ("All projects"):** per project: colour/logo, running now, failures, open inbox items, cost today/week, area health, and a mini fan of its C-suite cards.
- **Optional holding view:** a Studio X root above every project's C-suite, giving one org chart across everything.
- **Ways to switch projects:** the header switcher with breadcrumb (_All projects › DJVibe › Content_), the command palette ("Go to project…"), recent-project shortcuts, and `orca goals open --project djvibe`. It defaults to the project of the active workspace, else the last one viewed.
- Project-level CRUD in the org chart: colour, logo, starter pack, archive, and **pause project** (pauses every goal in it). Adding the repo itself stays Orca's normal "add project" flow.

### Menu map (where it shows up in Orca's sidebar)

Orca's left sidebar today: Search, Setup guide, **Tasks**, Artifacts, Skills, **Automations**, Agent dashboard, Mobile (`SidebarNav.tsx`). Each entry can be hidden from its right-click menu. **No new top-level entries.** The work goes into the two that already exist, plus badges:

```
Sidebar                         Opens
─────────────────────────       ──────────────────────────────────────────────
🔍 Search                       + "Go to project…", "Open goal…", "Open item…"
✅ Tasks            ● 3          GitHub | GitLab | Linear | Jira | Goals (new)
                                  Goals = local work items (§3h): Board | List
                                  type tabs: Features · Bugs · Content · …
                                  badge = items waiting on you (approve/reject)
🗓 Automations      ▶2 ⚠1        [All projects ▾] › DJVibe › Content
                                  Org chart | Pipeline | Automations | Runs | Cards
                                  badge = running now / failed or stuck
   (worktree list)               automation-run worktrees show 🤖 + item chip
```

- **Automations** = the _who and when_. Its sub-tabs:
  - **Org chart** (default): the cards, areas and managers (§3c).
  - **Pipeline**: the flow strip of goals and queue pipes (§3g).
  - **Automations / Runs**: the existing lists, with a project filter.
  - **Cards**: deck packs (§3a).
  - The Goal Viewer opens on top when you click a card.
- **Tasks → Goals** = the _what_: features, bugs and content as a PM board (§3h).
- **The two link to each other:**
  - a queue pipe in Pipeline opens Tasks filtered to that stage;
  - an item's drawer opens its owner goal or its run;
  - a goal card shows "working on: <item>".
- **One project switcher state** is shared by Automations and Tasks → Goals. Picking DJVibe in one picks it in the other.
- **"Needs you" stays in the badges**, not in a separate page:
  - the Tasks badge counts items awaiting approval or decisions (pitches, retro proposals, blocked items);
  - the Automations badge counts failed or stuck runs;
  - each badge opens its list pre-filtered.

  The same counts feed desktop notifications, the mobile app and `orca goals status --json` for the bot.

- **Worktrees created by automation runs** appear in the normal worktree list with a robot marker and the item they are working on. That is where you drill in and take over (§3e).
- Runs on a project's automation worktree (ops goals, §3f) can be grouped under one collapsible "Automation" row per project, so they don't crowd the list.

## 3c. UI direction: Cascade's Operations board and Goal Viewer become Orca's goal UI

Decision (2026-11-02): Cascade's **Operations dashboard** and **Goal Viewer** are the target look. Orca's automation table stays as a secondary **"List"** view (useful for plain automations, bulk edits and hosts).

Port strategy: **lift and shift, then adapt the data.**

- Copy the Cascade components almost verbatim: `operations.tsx` (area grid ↔ org chart, filters, theme/image-mode switcher, running-job tail sheet), `AutomationAreaGroups`, `AutomationCard`, `GoalDetailPanel` + `ops-goal-viewer-shell`, `RunBattleMeter`, `OpsCastingCostPips`, `automation-card-identities.ts`, and the `ops-*` CSS.
- Write one adapter, **`toAutomationStatus(goal, automation, runs, usage, limits)`**, that builds Cascade's existing `AutomationStatus` / `AutomationJobs` shapes (`types/command-centre.ts`) from Orca data. The UI code then needs almost no changes, and the adapter is the only seam to maintain.
- **Phase 1 data source (read-only, no runtime work):** the adapter reads `automations/goals/*` (GOAL frontmatter, STATUS, logs, inbox counts) plus `automation-runs.jsonl` and crontab, which the `xos` branch already parses. So the board shows the live Cascade/djvibe goals in Orca **before** any goal migrates.
- **Phase 2:** the adapter switches to Orca automations and runs as goals migrate. The UI does not change.
- Swap the Laravel and Inertia actions for Orca actions:
  - "View live tail" → open the run's terminal.
  - Manual run command → **Run now**.
  - Recommended manager command → a one-click run.
  - Open Codex/Grok → launch an agent tab with the goal-scoped prompt.
  - File links → open in Orca's editor.
- Goal Viewer tabs: Overview (facts, status fields, runs, usage, logs), Projects (Special Projects), Photo Studio. The Messages tab becomes a **read-only thread view**, because sending goes through the bot/CLI (§2.3).
- Project switcher (§3b) sits in the board header, so the board shows one deck or all projects.

## 3d. Full CRUD from one central place

Requirement (2026-11-02): one central Orca view to **see everything and create, edit, pause/resume, run and delete** it. It must not be a read-only dashboard.

| Entity                                 | Create                                           | Read              | Update                                                                                          | Pause / resume                              | Run / stop                                       | Delete                                      | Exists in Orca?                                              |
| -------------------------------------- | ------------------------------------------------ | ----------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------ | ------------------------------------------- | ------------------------------------------------------------ |
| Orca automation                        | ✅                                               | ✅                | ✅                                                                                              | ✅                                          | ✅ Run now (stop: verify)                        | ✅                                          | yes                                                          |
| **Goal** (contract + state)            | hire from a card or blank                        | board + viewer    | contract editor (frontmatter form + markdown), model/fallback/Auto, schedule, lane, owned paths | ✅ + "pause after current run"              | Run now (normal / reply / sidecar), stop running | **archive** (default), restore, hard delete | new                                                          |
| **Legacy cron job** (during migration) | —                                                | ✅ (`xos` branch) | edit schedule/command                                                                           | comment / uncomment the line                | run now in a visible Orca terminal               | remove the line                             | new (crontab manager is read-only today: `canManage: false`) |
| **Area / project / deck**              | ✅                                               | ✅                | rename, re-parent goals, set manager                                                            | **bulk pause** of everything under it (PF2) | run all due now                                  | archive                                     | new                                                          |
| **Card template / pack**               | from a goal ("save as card"), from words, import | collection view   | identity, art (upload/regenerate), contract skeleton                                            | —                                           | —                                                | ✅                                          | new (Orca's `automation-templates.ts` is the seed)           |
| **Run**                                | —                                                | ✅                | —                                                                                               | —                                           | stop, re-run, re-run on another model            | delete from history                         | partial                                                      |
| **Message**                            | ✅ (CLI + read-only thread in the viewer)        | ✅                | mark processed                                                                                  | —                                           | —                                                | ✅                                          | new                                                          |

Rules that keep CRUD safe:

- **Archive before delete.** Deleting a goal moves its folder to `goals/_archive/` and disables its schedule, keeping runs and history. Hard delete needs a typed confirm. Deleting a running goal stops it first.
- **Every edit is versioned.** Contract and identity edits create a new version (PF6), with diff and one-click revert. Edits auto-commit in the goals-home git repo.
- **Crontab edits are guarded.** Orca writes only its own `# orca-xos managed` lines or lines the user explicitly adopts. It backs up the crontab before every write (as djvibe's installer scripts already do) and refuses if the crontab changed since it was read.
- **Hiring or editing a card with deploy/push/production authority** needs an explicit confirm that shows those permissions.
- **Bulk actions** (multi-select on the board, area-level pause) show a preview of what changes.
- **Every mutation goes into an audit log** visible in the UI and via `orca goals history`.
- **The CLI gets the same verbs** (`orca goals create|edit|pause|resume|run|stop|archive|delete`) so the Grok/OpenAI bot can do anything the UI can.

## 3e. Auto by default, drill in when it breaks (hybrid workflow)

Goal: runs are fully automatic most of the time. When one breaks (error, out of credit, stuck), you can open that exact agent session, see what happened, and **take over manually**, including on another model, then hand it back to automation. All session history stays.

What Orca gives us today:

- Every automation run is a **real Orca agent session**. `AutomationRun` links `chatSessionId` / `terminalSessionId` / `terminalPtyId`, so a run can be opened like any tab.
- **Chat-surface runs** keep a persisted transcript (agent-session journal), typed usage-limit events and continue-after-reset. They also appear in Orca's **AI Vault** session search across agents.
- **Terminal-surface runs** are kept only briefly: `headless-run-terminal-retention.ts` closes idle run terminals after 10 minutes and keeps the last 3 per automation, unless you used or viewed them. After that only an output snapshot remains.
- Agent→agent **handoff cards** (`agent-launch-handoff-card.ts`) already link a new session to the one that started it.

Design:

1. **Goals default to the chat surface**, so every run has a durable, searchable transcript. Terminal surface stays opt-in. For goals that use it, retention changes to "keep the last N runs' scrollback on disk" rather than closing it.
2. **Goal lifecycle states:** `auto` → `needs attention` (failed / limited / stalled past `estimated_runtime`) → `operator at the helm` (taken over) → `auto` (released). The card shows the state (e.g. a helm badge, and the fire tone for needs attention). An Orca notification deep-links straight into the session.
3. **Drill-in actions** on any run (Goal Viewer, Runs list, notification, CLI):
   - **Open session**: jump into the run's chat or terminal with its full history.
   - **Continue here**: resume the same session (same agent) and chat with it.
   - **Continue on…**: model picker (§3.2). Starts a new session in the same workspace, primed with the goal prompt, the failed run's transcript summary and last turns, and "you are taking over from run #N". It is linked as a child run (handoff card + `parentRunId`).
   - **Retry**, **Retry on another model**, **Wait for reset**.
4. **Takeover holds the goal's lock.** While you are at the helm, the goal's lane lock belongs to your session, so scheduled runs queue (or skip, per goal) and nothing collides with you.
5. **Release back to auto**: one button. Orca first asks the session to update STATUS.md with a handoff note, so the next automatic run resumes cold. Then it releases the lock and resumes the schedule. The manual session is recorded as a run (`trigger: manual_takeover`) in the same history.
6. **Manual sessions started from a goal** (e.g. "Open Codex/Grok with this goal") are also recorded as runs of that goal, so automatic and manual work share one timeline.
7. **Run lineage view** in the Goal Viewer: scheduled run → fallback hop(s) → takeover session(s) → release, each a click into its transcript, with tokens/cost per step.
8. **"All sessions for this goal"**: AI Vault results filtered to the goal's sessions, including older ones.
9. The bot gets the same actions through the CLI: `orca goals runs <goal>`, `orca runs open|continue|takeover|release <run>`.

Roadmap: items 1–3 fit stage A (they use existing session plumbing). Items 4–7 come with the goal entity (stage B). Item 8 comes with stage D.

## 3f. Where runs execute: main checkout vs. worktrees

Today: Cascade, djvibe and studiox run **every goal directly in the single main checkout on `main`** (`git worktree list` shows only `main`). That is why the framework needed lane locks, a global `git-commit.lock`, scoped auto-commit, and a whole **`worktree-janitor` goal** whose job was to clean up dirt other goals left on `main`.

Orca's model: automations choose `workspaceMode: existing` (run in a chosen workspace, such as the main checkout or any worktree) or `new_per_run` (fresh worktree per run, set up with the project's `orca.yaml` setup script).

Recommendation: the run location is a per-goal setting, set by the card's kind, with sensible defaults:

| Goal kind                            | Examples                                                             | Runs in                                                                         | Why                                                                                               |
| ------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Ops / research / reporting**       | ops director, managers, TLDR, trend researcher, retrospectives       | **Project automation workspace** (below)                                        | Mostly reads code and writes to the central goals home (§5), so no repo changes and no setup cost |
| **Code-changing**                    | implement-feature backlog, fix-qa-bugs, chart/feature work           | **New worktree per run** → branch → tests → PR or auto-merge into `main`        | No collisions on `main`, no janitor; each change is reviewable; matches the XOS dev→deploy loop   |
| **Local data / media / app content** | db-media lane, content publisher, festival curator, chart maintainer | **Project automation workspace**, keeping the lane lock                         | They mutate the shared local DB, storage and media, which worktrees do not isolate                |
| **Deploy**                           | production-deploy, staging-deploy                                    | The automation workspace (or a clean temp release tree, as djvibe already does) | Deploys a specific tested commit; keeps the `deploy` lane lock                                    |

**Project automation workspace:** one long-lived Orca worktree per project (e.g. `djvibe.com` → `automation` worktree), reused by every non-code goal.

- Before each run it is fast-forwarded to `main`. After the run, any repo changes are committed and pushed by the post-run step (RT8).
- **Your own main checkout is never touched by automation**, so interactive work and automation stop stepping on each other.
- Setup cost (composer/npm install, `.env`, storage link) is paid once, not per run.

Laravel worktree setup (needed for per-run worktrees): an `orca.yaml` setup script per project that copies `.env`, runs `composer install` / `npm ci` (with a shared cache), links storage, and points at the shared local DB (or a per-worktree SQLite where tests allow). Without it, "new worktree per run" is slow for these apps.

Locks still matter, but less: per-run worktrees remove file collisions for code goals. Lanes remain for shared resources (local DB/media, deploy, git push to `main`).

## 3g. Queues and handoffs: the file structure is the work signal

In Cascade the folders did the scheduling, not just the storage. Every goal had an input queue and an output queue. Cron fired often, and each run checked its folders first and exited cheaply when there was no work, or when the next stage was already full. Goals handed work to each other by **moving a markdown file** from one folder to the next. That is how the dev loop (Dream → Groom → Build → QA → Fix → Retro) ran by itself, and Orca needs to keep it.

**The Dev Shop loop as queues (Cascade today):**

| Goal                                | Reads (input queue)                                                                     | Writes (output queue)                                                                                                                                                      | Self-gating rule (today lives inside GOAL.md prose)                                                                       |
| ----------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `feature-dreamer`                   | `themes.md`, `competitors.md`, rejection buckets (feedback)                             | `feature-dreamer/inbox/*.md` (max 5 pitches per run)                                                                                                                       | Stop if inbox has 30 or more files, if 8 or more planned specs are `ready: true`, after 3 dry runs, or after 3 runs today |
| `feature-backlog-groomer`           | `feature-dreamer/inbox/*.md` and `inbox/accepted/`, plus stale `docs/features/planned/` | `docs/features/planned/*.md` with a `builder:` block, or a rejection bucket (`not-now`, `too-big`, `off-brand`, `wrong-direction`, `duplicate`, `not-interested`, `other`) | Keep the ready count between a **floor of 5** and a **ceiling of 8** (hard cap 10). No-op when nothing to groom           |
| `implement-planned-feature-backlog` | `docs/features/planned/` where `builder.ready: true`, ordered by priority and rank      | Code + tests + commit, spec moved to `docs/features/completed/`                                                                                                            | DoD when no ready specs remain                                                                                            |
| `staging-qa`                        | Each staging deploy                                                                     | `automations/bugs/inbox/*.md` (deduped)                                                                                                                                    | Runs after deploy                                                                                                         |
| `fix-qa-bugs`                       | `automations/bugs/inbox/`, then `docs/bugs/incoming/`                                   | `bugs/resolved/`, `docs/bugs/{in-progress,fixed,archived}/`                                                                                                                | DoD when both inboxes are empty; must finish an interrupted bug before picking another                                    |
| `feature-loop-retrospective`        | Builder logs, completed specs, `inbox/approved/`                                        | Proposals into `inbox/` (needs approval), applied ones to `inbox/processed/`                                                                                               | Weekly                                                                                                                    |
| `feature-dev-manager`               | Every child's STATUS, logs and queue counts                                             | Area health (`healthy` / `watch` / `action_needed` / `blocked`), next move, `assets/latest-summary.md`                                                                     | Runs children until healthy or a stop condition                                                                           |
| Any goal                            | `inbox/*-operator-*.md` with `status: open` and no `responded_at`                       | Reply, then the file moves to `inbox/processed/`                                                                                                                           | `run-inbox-watch.sh` scans every minute and starts a cheap reply run (RT9, RT11)                                          |

**Problems with the old way:**

- The gating rules lived in prose that the agent re-read on every run, so tokens were spent just to decide there was nothing to do.
- The cron fired regardless, so "nothing to do" runs showed up as noise.
- The dashboard counted folders on every page load.
- Nothing recorded how long an item sat in a queue.

### How it fits Orca

**1. Queues become declared data, not prose.** Each goal declares its queues in GOAL.md frontmatter, which is editable in the goal editor:

```yaml
queues:
  in:
    - id: candidates
      path: inbox/ # relative to the goal home (§5)
      ready_when: count >= 1
  out:
    - id: ready-specs
      path: items/feature/planned/ # relative to the Orca project home
      match: builder.ready == true
      floor: 5 # below this, upstream is "starved" (wake the groomer)
      ceiling: 8 # at or above this, upstream pauses (backpressure)
      hard_cap: 10
  rejects: inbox/{not-now,too-big,off-brand,wrong-direction,duplicate,not-interested,other}/
max_runs_per_day: 3
```

**2. Orca evaluates the gate itself, before spawning an agent.** A built-in "queue gate" runs next to the existing `precheck`, at zero token cost.

- If the input queue is empty or downstream is at its ceiling, the run is recorded as `skipped_precheck` with a readable reason, such as "inbox empty" or "downstream full: 8/8 ready".
- Orca's current precheck is a shell command judged only by its exit code. It runs only for scheduled triggers, and its stdout is not passed to the agent.
- Two small extensions:
  - (a) native queue rules;
  - (b) a short queue snapshot injected into the prompt, such as "12 candidates, 3 ready specs, oldest 4d", so the agent no longer re-counts folders.
- Adds **RT16** (queue gate) and **RT17** (queue context in prompt).

**3. Event triggers replace polling.** Orca watches the input-queue folders (it already has to watch the goal home for the index, §5).

- When a file lands, the goal is queued to run, debounced and capped by `max_runs_per_day` and the lock lane.
- When downstream drops below its floor, the upstream goal wakes. That is the "keep Builder fed" rule, made mechanical.
- The schedule stays as a safety-net sweep.
- This is RT11 generalised from operator messages to every queue.

**4. Where queue folders live: all in Orca, none in product repos (decided 2026-11-03).**

- Every queue and work item lives under the Orca project home: `~/.orca-xos/projects/<project>/`.
  - `items/<type>/<stage>/*.md`: features, bugs, content and festivals, e.g. `items/feature/planned/`.
  - `goals/<goal>/`: goal-private files such as the inbox, rejection buckets and retro proposals.
- The project home is one git repo per project. Orca auto-commits it, so item history survives without adding commits to product repos (the old framework caused about 97% of Cascade's commits).
- **Product repos keep only code.** Builders, fixers and writers work in a worktree of the product repo and read their item by absolute path (`ORCA_PROJECT_HOME`, `ORCA_ITEM`), which works because everything runs on one machine.
- **Orca moves items between stages, not the agent's commit.**
  - The run claims the item.
  - On success, Orca moves it to the next stage and records the branch, commit, PR and run id in its frontmatter.
  - On failure, the item goes back to its stage, unclaimed, with the error attached.
- For history on the code side, the builder puts the item id and title in its commit message or PR body (`Item: feature/123-…`).
- **Migration:** `orca goals import [--goal a,b] [--force]` copies `automations/goals/*` (one goal at a time with `--goal`; goals already in the home are kept unless `--force`), `docs/features/*`, `docs/bugs/*` and `docs/feedback/*` from each repo into the project home. After a week of matching receipts, those folders are deleted from the repo.
  - Nothing in the apps reads them at runtime, only the Command Centre, `RefreshDashboardSummary` and `LintFeatureDirectory`, which all retire with the Laravel automation pages.
  - DJVibe also has `docs/projects`, which needs checking before import.
- Queue paths in GOAL.md resolve against the goal home, then the project home, then (during migration) the repo.

**5. Claiming.** Lock lanes alone can't stop two runs, or a manual "Continue on…" session (§3e), from picking the same item.

- When a run takes an item, Orca writes `claimed_by: <run id>` and `claimed_at` into the item's frontmatter.
- The queue gate ignores claimed items.
- A claim older than the run's timeout is released automatically.

**6. Item history comes for free.**

- The index records every file move as a transition (item, from, to, run id, time).
- That gives, with no extra agent work:
  - time in each queue;
  - stuck-item alerts;
  - the funnel (Dreamer inbox → Accepted → Ready → Completed);
  - weekly velocity;
  - **cost per shipped feature**, because each transition carries the run id and therefore its tokens.
- Rejection reasons become real stats ("40% `too-big` this month"), which is the feedback the dreamer reads.

**7. The UI: a Pipeline view inside Automations.** It sits next to the Org chart and uses the same "All projects" switcher. It is the generic Queue Board from §2.7, laid out as a flow.

- **Flow strip:** goal cards (Cascade card art) joined by queue pipes that show counts and the floor/ceiling band. Starved pipes are amber, backed-up pipes red, healthy green. Clicking a pipe opens its board.
- **Queue Board:** columns = folders, cards = items with frontmatter chips (priority, rank, size, risk, ready).
- Full CRUD (§3d):
  - drag an item between columns (= file move, audited);
  - approve or reject a pitch into a bucket;
  - edit the `builder:` block;
  - "Build this now" starts the builder in a new worktree on that one spec, which is the drill-in path from §3e.
- **Bug Queue** and **Content Pipeline** are two more queue configs, not new screens.
- The area manager's health (`feature-dev-manager`) is computed mostly from queue rules (starved, backed up, stuck item age). The manager agent then only has to explain the health and act on it.

**8. Templates/decks (§3a).** A deck pack ships its goals **with their queue wiring**. Installing _Dev Shop_ creates the dreamer, groomer, builder, QA, fixer and retro goals, and pre-connects their queues, so the loop runs as soon as it is installed. The Content Studio pack is the same idea for research → ideas → briefs → drafts → published.

**Pilot note:** DJVibe only has `staging-qa` from this loop, plus its content loop. Prove the queue gate and Pipeline view on DJVibe's **content** loop first (same mechanics). Then bring Cascade's Dev Shop over as the first full deck install.

## 3h. PM view: work items in Orca's Tasks section

§3g covers _when_ goals run. This section covers the _items_ they move along, the PM view: what is in the backlog, how far each item has got, and who touches it next.

**What Orca has today:** the **Tasks** page reads outside trackers: GitHub issues, PRs and Projects (including a kanban `ProjectBoard`), GitLab, Linear and Jira. From any task you can start a workspace (worktree + agent) linked to it. It has **no local or file-based source**, and nothing in it knows about automations.

**Options considered:**

| Option                                                 | Good                                                                                                                                                                                                                                     | Bad                                                                                                                                                                      |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A. GitHub Issues/Projects as the backlog               | Already in Tasks, mobile app, PR linking, Cascade already had github-sync (PL4)                                                                                                                                                          | Every agent read/write is an API call (rate limits, network, slower, more tokens); long specs in issue bodies are clumsy; dreamer's 30-pitch firehose would flood issues |
| B. Separate board inside Automations only              | Simple to build                                                                                                                                                                                                                          | Two places to look for "work"; ignores the Tasks UX Orca already has                                                                                                     |
| **C. Local work items as a new Tasks source (chosen)** | Items stay markdown files (cheapest for agents, already how Cascade works); the PM view lives where Orca users expect tasks; "start workspace from task" already exists and becomes the manual drill-in; GitHub stays an optional mirror | New task-source provider to build (but it is read/write on local files, so simpler than the remote ones)                                                                 |

**Recommended design (C):**

1. **One item = one markdown file that gets enriched as it moves.** Each stage's goal adds its own section and frontmatter, so the spec builds up in one place:
   - Idea (dreamer): pitch, `dreamer:` provenance.
   - Groomed (groomer): full spec, acceptance criteria, `builder:` block (`ready`, `priority`, `rank`, `size`, `risk`, `touches`).
   - In progress (builder): `claimed_by`, worktree/branch, implementation notes.
   - Verify (QA): verification result, linked bug items.
   - Done: commit/PR link, cost, cycle time.
     The `stage` is the folder it sits in (§3g), so moving the file still drives the automation.

2. **New Tasks source: "Goals" (local).** Next to GitHub/GitLab/Linear/Jira in the Tasks source bar, scoped by the "All projects"/project switcher.
   - **Board view:** columns = stages (reusing the `ProjectBoard` kanban layout). **List view:** sortable by priority, rank, size, age, owner goal.
   - Item **types** come from queue configs: Feature, Bug, Content piece, Festival, Proposal. Each type has its own stages, e.g. Content: Research → Idea → Brief → Draft → Published.
   - **Item drawer:** rendered spec with editable frontmatter chips, plus an **activity timeline**. The timeline comes from the §3g transition index and shows which goal moved or enriched the item, when, on which run, at what cost, with a link to that run's transcript.
   - **Actions:**
     - create item (operator idea → straight into the right inbox);
     - edit spec;
     - drag to a stage;
     - approve/reject with a reason bucket;
     - set ready;
     - **"Build now"** starts the builder in a new worktree on this one item, using the existing start-workspace-from-task flow;
     - **"Work on it myself"** opens a manual agent session on it (§3e).
   - CLI for the bot: `orca items list|show|create|move|edit --project --type --stage --json`.

3. **Automations ↔ Tasks link.**
   - The Automations **Pipeline view** (§3g) shows the flow: goals and pipes with counts and health. Clicking a pipe opens Tasks filtered to that stage.
   - Each goal card shows "working on: <item>".
   - Each item shows its owner goal and its next goal.

4. **GitHub for the outside world only (decided 2026-11-03, after checking `gh` and Orca's GitHub code):**
   - **Orca does not sync GitHub locally.** Its GitHub Issues and Projects views (`src/main/github/project-view/*`) call the live API and keep only in-memory caches. Reads need the network and count against the shared limit of 5,000 GraphQL points an hour. Agents would hit the same limits through `gh`.
   - **GitHub Projects** (v2) can do the job: `gh project item-list/item-edit/field-create`, custom fields, and Orca already has a Projects board with field editing. But drafts are not real issues, long specs live in the issue body, and every move is an API call. Also, the current `gh` token lacks the `read:project`/`project` scope (`gh auth refresh -s project`), and the installed `gh` is 2.45 (old).
   - **Local files are the source of truth** for the internal loop (dreamer → groomer → builder → QA). That is the fastest option, it works offline, it costs no API calls, and agents read files cheaply.
   - **GitHub Issues = intake from outside:**
     - customer and outside bug reports, feedback and feature requests come in as issues;
     - Cascade's existing `automations/github-sync/` already classifies issues (feature/bug/feedback/support/invalid), labels them, routes them to local files, adds a hidden "processed" marker, and **closes the issue when its feature doc reaches `completed/`**;
     - port that as a small sync goal or Orca job per project. The sync writes local items with `source: github#123`, and the item drawer links back to the issue.
   - **GitHub Projects (optional, later):** a read-only mirror of selected items, if you want an outside view of the roadmap. It is not used for agent work.

5. **Templates (§3a).** A deck pack declares its item types and stages along with its goals. Installing _Dev Shop_ adds the Feature and Bug types to Tasks; _Content Studio_ adds the Content type.

**Roadmap placement:**

- **Stage 0:** a read-only "Goals" Tasks source over the existing Cascade/DJVibe repo folders (`docs/features/*`, `docs/bugs/*`, dreamer inbox, djvibe content queues) until `orca goals import` moves them into the project home, with board + drawer.
- **Stage B:** the transition index and timeline.
- **Stage C:** CRUD actions and the `orca items` CLI.
- **Stage D:** "Build now" and claiming.
- **Stage E:** funnel, velocity and cost per item.

## 4. Expansion roadmap

| Stage                       | Contents                                                                                                                                                                                                                                                                                                                                                                        | Unlocks                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **0. Central board**        | §3c Operations board + Goal Viewer in Orca over existing goal folders, receipts and crontab; §3b project switcher; **§3d CRUD for goals and legacy cron jobs** (edit contract/schedule, pause/resume, run now, archive/delete) with backups, versioning and audit log; **read-only queue counts** on cards (§3g); **read-only "Goals" Tasks source** (board + item drawer, §3h) | One central place to see and control everything, before any runtime migration              |
| **A. Runtime parity**       | §3 model picker + fallback list + Auto, RT4, RT6, RT7, RT8, RT15, GD2                                                                                                                                                                                                                                                                                                           | Any single Cascade/djvibe goal can run from Orca with identical safety                     |
| **B. Goal entity**          | GS1–GS3, GS6, GS7, RT3, RT9, RT10, RT12, RT14, **RT16 queue gate + RT17 queue context + claiming (§3g)**; `orca goals import <repo>` reads `automations/goals/*`                                                                                                                                                                                                                | "Orca Goals": one goal = contract + state folder + run modes + lane + chain                |
| **C. Agent API**            | §2.3a CLI commands (`orca goals …`, `orca usage …`, `orca models list`), MS1/MS3/MS7, RT11 generalised: event triggers on any input queue plus floor-based wake-ups (§3g)                                                                                                                                                                                                       | Grok/OpenAI operator bot can read everything and message goals; inbox watcher cron retired |
| **D. Operations UI (live)** | Switch the §3c adapter to Orca runs; actions (Run now, live tail, manager command, open agent); UI9, OV1, OV2                                                                                                                                                                                                                                                                   | The board drives real Orca goals, not just shows them                                      |
| **E. Analytics + boards**   | OV3, OV4, PL1–PL4 as the **Pipeline view** (flow strip + Queue Boards, item history, funnel, velocity, cost per feature; §3g), GD6, OV5                                                                                                                                                                                                                                         | Laravel automation pages can be deleted                                                    |
| **F. Personas and media**   | EM1–EM6 (generic: avatar, references, galleries, review, sidecar generation)                                                                                                                                                                                                                                                                                                    | Employee studio; Cascade-only builders (listing picker) optional                           |
| **G. Portfolio**            | PF1–PF7                                                                                                                                                                                                                                                                                                                                                                         | The XOS vision without a separate app                                                      |

### 4a. Implementation status

State below is about source on `xos`. **Installed** means running on this machine; "Code" never implies it.

| Stage | State                                                  | Installed | Reachable from                                     | Still open                                                                                                                                 |
| ----- | ------------------------------------------------------ | --------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **0** | Code; board and §3d CRUD in use                        | Partly    | Org chart, Tasks → Goals                           | §3b project filter on the list, runs dashboard and `orca automations`. Queue chips and Tasks → Goals are newer than the installed build    |
| **A** | Code, not live-tested                                  | No        | Automation editor and detail page                  | "Wait for reset"; a `limited` run status on upstream's run row (the ledger records it; the row stays `completed`)                          |
| **B** | Code, not live-tested                                  | No        | Run now, bound automations, `orca goals run`       | Template/instance split                                                                                                                    |
| **C** | Code, not live-tested                                  | No        | `orca goals …`, opt-in queue triggers              | `orca runs open/continue/takeover`; bot and mobile alert delivery (`goals notify` only queues)                                             |
| **D** | Code, not live-tested                                  | No        | Goal Viewer, Orca scheduler via bound automations  | AI TLDR banner (OV1; `goals briefing` is the deterministic rollup), Up next (OV2), run lineage view, "All sessions for this goal"          |
| **E** | Code, not live-tested                                  | No        | Pipeline and Analytics views, `goals github-sync`  | Queue Board drag and approve/reject on the flow strip; per-run cost in `transitions` (cost per feature still matches usage by time window) |
| **F** | Code, not live-tested                                  | No        | Goal Viewer                                        | Depth not audited; Maya/photoshoot extraction is outside this repo                                                                         |
| **G** | Modes, sprint and budgets constrain dispatch; not live | No        | Portfolio, `checkDispatchPolicy` on every dispatch | PF4 reservation (budgets only stop new runs), PF5 approvals beyond media review, PF6 versioned definitions beyond git                      |

Stage A as built (all fork code in `src/main/xos/` and `src/renderer/src/components/xos-goals/`; settings live in `~/.orca-xos/automation-runtime.json`, run events in `~/.orca-xos/automation-runs.jsonl`):

- **A1 §3.2 model picker**: Model + Effort selects in the automation editor (terminal surface), from the live catalog; writes upstream `extraAgentArgs` (`src/shared/xos-model-args.ts`).
- **A2 RT4/RT5/RT6 fallback chain**: terminal runs have no exit code, so `xos-limit-classifier.ts` reads the last 25 screen lines (usage limit, spend cap, 429, overloaded, auth, missing binary). A limited run starts a linked retry on the next model (`xos-run-fallback.ts`); manual runs only when opted in. Notification per hop.
- **A3 RT7 + RT15**: lane locks share `run-goal-cron.sh`'s flock files (`xos-lane-lock.ts`), busy lane = skip or queue with wait; per-automation timeout (`xos-run-gate.ts`).
- **A4 RT8**: post-run commit of owned paths only, under the shared `git-commit.lock`, optional push; copy paths from the legacy `commit-automation-changes.sh` (`xos-auto-commit.ts`). Existing-workspace, local runs only.
- **A5 §3.3 Auto + §3.4 before-launch skip + GD2**: tier/agents/reserve/effort; ranking by remaining quota relative to reset from `RateLimitService` (`xos-auto-mode.ts`, `xos-quota.ts`); editable tier map; run history with model, reason, duration, outcome, commit.

Upstream hooks (keep minimal when rebasing): `automation-dispatch-request.ts` (`xosBeforeLaunch`), `automations/service.ts markDispatchResult` (`xosAfterRunFinished`), `runtime-automation-service.ts` (`registerXosAutomationHost`), `provider-account-services.ts` (`registerXosQuotaSource`), `AutomationEditorSettingsSidebar.tsx` and `AutomationDetail.tsx` (UI mounts).

Known gaps: Auto picks across agents, not across accounts of one agent; antigravity has no model flags; native runs support claude and codex only; Build now commits on its branch but opens no PR (pushing is an operator step); a chat run's timeout closes its surface but cannot interrupt a provider turn that has no pane.

### 4b. Stage B implementation (`djvibe/xos-stage-b-goal-entity`)

Stage B is implemented in five slices:

- **B1 GS1–GS3, GS6, GS7 + `orca goals import <repo>`**: Centralized project home (`~/.orca-xos/projects/<slug>/` with `goals/`, `shared/`, `AGENTS.md`, `items/<type>/<stage>/`, `org.json`, `project.json`), Git repo initialization + auto-commit, dual-source discovery in `xos-goal-board.ts`, `xos-goal-entry.ts`, and `xos-work-items.ts`, and `orca goals import [<repo>] [--json]` CLI (`src/main/xos/xos-project-home.ts`, `src/cli/specs/xos-goals.ts`, `src/cli/handlers/xos-goals.ts`).
- **B2 RT2, RT3, RT9, RT10, RT12, RT14**: Prompt assembly (`AGENTS.md` + `GOAL.md` with recursive `@shared/...` include expansion and cycle/path-traversal guards + optional `SOUL.md`/`LESSONS.md`/`DECISIONS.md` + `STATUS.md` + `MEMORY.md` + open `inbox/*.md` marked read + latest log), `reply` inbox-only mode (`gpt-5.4-mini`, `low`, `dm` lane, no fallback, no auto-commit), `sidecars/<name>.md` contracts, operator run-with-message, and `Definition of Done met` stop/reopen handling (`src/main/xos/xos-goal-prompt.ts`, `src/main/xos/xos-goal-inbox.ts`).
- **B3 RT16, RT17, §3g.1–3g.6**: Declared `queues:` frontmatter in `GOAL.md` with fallback to `LEGACY_ITEM_TYPES`, pre-run queue gate (`skipped_precheck` on daily cap, empty input queue, or downstream ceiling/hard cap), queue snapshot in prompt, item claiming (`claimed_by`/`claimed_at` with automatic stale-claim expiry), and stage transition index (`transitions.jsonl`) (`src/main/xos/xos-declared-queues.ts`, `src/main/xos/xos-queue-gate.ts`, `src/main/xos/xos-item-claims.ts`).
- **B4 RT13 + Chat-surface model/fallback**: Nested child runs in the same lane inherit the active lane lock via `CASCADE_ACTIVE_LOCK_LANE` or `xosGrantInheritedLane` while retaining per-automation self-recursion locks (`xos-run-gate.ts`), and chat-surface automation runs forward `sessionOptions` (`model`/`effort`) and classify typed `AgentSessionFailureFact` (`usageLimitReached`, `notSignedIn`, `cliMissing`, `providerRetrying`) for fallback retries (`automation-chat-agent-launch.ts`, `automation-chat-run-observation.ts`, `xos-limit-classifier.ts`, `xos-run-fallback.ts`).
- **B5 Goal Runner & Viewer UI**: `xos:goals:runNow` supports `normal`, `reply`, `sidecar`, and operator `message` runs; `XosGoalViewer` adds `Reply inbox`, `GoalRunBar` (operator message + sidecar selector), `MEMORY.md`/`SOUL.md`/`LESSONS.md`/`DECISIONS.md` buttons, and `Import to ~/.orca-xos` (`xos-goal-ipc.ts`, `XosGoalViewer.tsx`, `XosGoalViewerParts.tsx`, `XosGoalManage.tsx`).

### 4c. Running goals and replacing cron (`xos` source, not yet installed)

- **Goals on the scheduler (C1).** `orca goals schedule <goal> --schedule "<cron>"` creates an Orca automation bound to the goal, **disabled**. Each dispatch checks portfolio policy, the legacy-cron guard, authority and the queue gate, then swaps in the assembled prompt, claims the item, and settles it after the run. Skips land as `skipped_precheck`.
- **Replacing cron (C2).** `orca goals migrate plan` maps every crontab job to `legacy-active`, `not-running` or `replacement-ready`, including lines paused by hand with `# PAUSED FOR ORCA MIGRATION <date>:`. `orca goals migrate replace --job <id>` creates the disabled replacement: a goal binding, or a script automation for everything else. A replacement is skipped at dispatch while its crontab line is active, so a job can't double-run. Only a resume of one line undoes a manual migration pause; bulk resume leaves it alone.
- **Durable runs (H8).** `~/.orca-xos/run-state/` journals every active run. Native and script runs write their own log and exit file, leases keep a lane held while the agent lives, and the next Orca adopts what it finds.
- **Queue triggers (H1)** are off until `orca goals triggers --enable --project <p>`. GitHub intake runs only through `orca goals github-sync` (schedule it as a script automation if wanted).
- **Authority (M15).** Native runs stay sandboxed until `orca goals authorize <goal> --confirm <goal>`. A contract change to its authority fields voids that, and a run reading an external inbox message never bypasses the sandbox. Goals on a production lane or with `auto_push` refuse unattended runs until confirmed.
- **New contract fields:** `owned_paths`, `timeout_minutes`, `fallbacks` (`agent:model`), `fallback_on_manual`, `auto_push`.

Migration happens _during_ B–E, one goal at a time: (1) the goal runs in Orca, (2) remove its crontab line (the `xos` crontab manager shows both, so nothing double-runs), (3) compare receipts for a week. djvibe's live content loop goes first (Cascade goal crons have been off since about July). Cascade and studiox goals get re-enabled selectively after stage C.

## 5. Decisions

Settled (2026-11-02):

- Model choice uses a **UI picker like the main chat model picker**, fed by Orca's live CLI model catalogs. There is an optional fallback list using the same picker, and an **Auto** mode that picks the best tier-matched model with quota left.
- **Messaging is external**: Grok bot / OpenAI agents (and Slack/WhatsApp in front of them) use the Orca CLI. There is no native messaging UI; a plugin panel is optional and comes later.

Settled (2026-11-02): **single-machine operation.** All goals run on this desktop; the VPS only receives published content and deploys. Orca's SSH/remote-host features stay available, but the XOS board hides host columns and filters by default.

Settled (2026-11-02): **the org chart is the primary organizing model.** Projects → business areas (each with a manager goal; the C-suite area sits above) → goals. Areas are first-class editable entities (§3d), not hard-coded constants. The board defaults to the org-chart view, with the area grid as the alternative. Area health rolls up from its goals, and pause/resume works at area level.

Settled (2026-11-02): **centralize everything automation-related in Orca.** Evidence:

- 5,084 of Cascade's 5,259 commits since June touched `automations/` (about 97% of the history is automation noise).
- `automations/` is 339 MB in Cascade, 137 MB in studiox and 13 MB in djvibe, with 7,475 files in Cascade.
- The Command Centre rescans these files and a 1.8 GB log directory on every page load.
- Dirty `STATUS.md` files blocked clean-worktree checks (XOS phase 0).

Layout:

- **Orca store (SQLite, our own fork-owned file, so we never migrate upstream's profile schema):** definitions and versions, card identities, templates/packs, schedules, model/chain, lanes, runs, fallback events, usage, messages, approvals, and the search index.
- **Orca goals home (files, outside repos):** `~/.orca-xos/projects/<project>/goals/<goal>/` holds GOAL/STATUS/MEMORY/SOUL/LESSONS, `log/`, `inbox/` and `assets/`; shared contracts and card art live there too. These stay plain files because agents read and write files natively (cheapest in tokens). Orca watches the folder and keeps the index current, so the UI never scans. The home is its own git repo, auto-committed by Orca, so history survives without polluting product repos. Runs get `ORCA_GOAL_HOME` and the path in the prompt. Work items (features, bugs, content) live there too under `items/<type>/<stage>/`, not in product repos (§3g.4).
- **What stays in product repos:** only what the product itself consumes: content drafts that get published, feature/bug docs the app links to, and deploy scripts. Goals reach the repo through their workspace, as normal agent work.
- **Benefits:** one place to back up; worktree-per-run goals all see the same state; no repo diffs from STATUS edits.
- **Risks:** the store is per machine (back up the goals home and SQLite nightly). That is acceptable: everything runs on this desktop, and only published content and deploys go to the VPS (through goals' existing deploy/publish scripts).

Still open:

1. **Card art and identities.** Global per Orca install, or per project?
2. **Employee media scope.** Generic (avatar, references, gallery, review, generate)? Port the Cascade listing/Maya builders?
3. **Auto mode policy.** Size of the interactive-work quota reserve? Should Gemini/Antigravity be allowed in Auto by default?
4. **Branch.** Build on `xos` (which already has the crontab manager), not `djvibe/trumpetfish`.

## 6. Pre-start checklist (open items found in the final review)

1. **Plan location.** Done: this file is `xos/PLAN.md` on the `xos` branch.
2. **Always-on scheduling.** Cron ran without anyone logged in; Orca automations need Orca or its headless daemon running (`src/main/orcad/orcad-automations.ts` runs the scheduler headless). Verify orcad keeps scheduling with the UI closed, and install it as a systemd user service with linger so schedules survive reboot and logout. Watch the CRD/LightDM D-Bus setup noted in `~/CLAUDE.md`.
3. **Non-agent jobs** (backups, spotify rolling, sync-feeds, production deploy, SSL). Should Orca _run_ them as "script automations" (fully central), or keep them in crontab and only manage them through the crontab CRUD? Recommendation: script automations in stage D. Crontab CRUD covers them until then.
4. **Secrets and env.** Deploy and QA credentials (`CASCADE_DEPLOY_*`, `CASCADE_QA_*`, …) come from env files today. Decide on per-project env injection for runs (Orca has a per-workspace env feature).
5. **History import.** Import or archive the old receipts (Cascade has 6.6k runs, plus token, fallback and limit logs) so analytics and card streaks don't start from zero.
6. **Away-from-PC alerts.** "Needs attention" should reach you through the bot (Slack/WhatsApp), and possibly the Orca mobile app, for remote drill-in.
7. **Upstream rebase and test routine** for the fork (`xos/build.sh`, switch scripts, and the targeted test suites to run per stage).
8. **Out of scope for now:** TheLine's Python production director, BrewPlus3, and the stale djvibe review/fix checkouts.
9. **Still-open decisions** (§5): card art global vs per project; employee-media scope; Auto quota reserve and Gemini in Auto.

## 7. Interview answers (2026-11-02)

| Topic                   | Decision                                                                                                                                                                                                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Card art and identities | **Shared default deck + per-project overrides** (name, art)                                                                                                                                                                                                                             |
| Photo studio            | **Generic only** in Orca (avatar, references, gallery, review, generate). The Maya/photoshoot work is preserved separately (below)                                                                                                                                                      |
| Maya / photoshoot work  | **Extract to its own repo now** ("persona studio": persona contracts, SOUL, prompt builders, galleries, media). It may become an Orca plugin or its own digital-influencer product later                                                                                                |
| Auto quota reserve      | **0%, use all of it** (no reserve for interactive work)                                                                                                                                                                                                                                 |
| Auto providers          | **Claude, Codex, Gemini/Antigravity** (not Grok)                                                                                                                                                                                                                                        |
| Script jobs             | **Orca runs them now** as script automations (scheduled shell commands with runs, logs and alerts), so crontab can be retired early                                                                                                                                                     |
| Secrets                 | **Keep the existing per-repo env files**; Orca never stores secret values                                                                                                                                                                                                               |
| Old history             | **Fresh start**: archive the old receipts and logs on disk; Orca history starts at migration                                                                                                                                                                                            |
| Alerts                  | **Bot (Slack/WhatsApp) + Orca mobile app + desktop notifications**                                                                                                                                                                                                                      |
| Always-on               | **orcad as a systemd user service with linger** (runs after reboot or logout)                                                                                                                                                                                                           |
| Pilot project           | **DJVibe**                                                                                                                                                                                                                                                                              |
| Plan file               | **Both**: commit as `xos/PLAN.md` on `xos` and publish a readable doc                                                                                                                                                                                                                   |
| In scope                | **Cascade, DJVibe, StudioX only** (not TheLine, BrewPlus3, or the djvibe copies)                                                                                                                                                                                                        |
| Upstream sync           | **Weekly rebase onto the latest upstream release tag** (not `main` tip); skip quiet weeks, go early for a wanted fix. Keep fork code in `xos-*`/`goal-*` modules with thin hooks, enable `git rerere`, and use one script for fetch → rebase onto tag → build → tests → conflict report |
| Operator bot target     | **OpenAI agent** first (CLI stays generic `--json`)                                                                                                                                                                                                                                     |
| First build session     | **Stage 0 org chart board**: All-projects switcher, Cascade cards, Goal Viewer, pause/resume/run now over existing goal folders and crontab, plus the orcad boot service                                                                                                                |
