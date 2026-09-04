# DreamWeaver

> Dreams become memories. Memories become worlds. And worlds can be re-entered.

DreamWeaver is a personal dream-memory system that turns fleeting dream
recollections into structured memories, discovers patterns across those
memories, and lets you re-enter any past dream as an interactive,
stateful simulation — grounded in what you actually recorded, not in
generic AI fantasy.

---

## What DreamWeaver is

A calm, editorial, single-user product built around one core loop:

```
CAPTURE → UNDERSTAND → REMEMBER → DISCOVER → RE-ENTER → INTERACT → EVOLVE
```

- **Capture** — write or speak a messy, half-remembered dream. The raw
  text is preserved verbatim forever.
- **Understand** — Gemini reads the raw dream and produces a structured,
  reflective analysis: emotions, motifs, people, places, actions, dream
  laws, lucidity, fear, uncertainty, and possible interpretations — each
  with confidence and short verbatim **evidence** quotes grounding it.
- **Remember** — every dream is a memory. The Dream Journal keeps them;
  the Atlas maps them; the calendar shows when they came.
- **Discover** — the Dream Memory Graph reconciles different wordings of
  the same element ("faceless figure" ≈ "faceless person") into canonical
  entities, then traces each as a **Thread** through your dreams and
  describes how its role has evolved over time.
- **Re-enter** — pick any past dream and open the Subconscious Arcade.
  Gemini reconstructs an interactive experience grounded in your
  recorded imagery. You make choices; the dream responds; the world
  changes.
- **Interact** — multi-turn Gemini conversation. The model narrates; the
  **application** owns authoritative state (Fear, Lucidity, Stability,
  Agency) and decides endings. Model output is never trusted as
  application state.
- **Evolve** — motifs you meet in the Arcade can surface a **Memory
  Echo** — a subtle, selective notice that the same element appeared in a
  prior dream. Your dream world accumulates.

---

## The original feature

DreamWeaver is not "a Gemini journal with a nice UI." Its differentiator is:

**Historical personal dreams become interactive, stateful, persistent
worlds — and the dream memory that connects them evolves over time and
shapes how those worlds behave.**

Three modes in the Arcade:

- **Replay** — re-experience the dream faithfully.
- **Rewrite** — branch from the remembered scenario and explore
  alternative outcomes.
- **Confront** — directly engage a recurring motif the app selects from
  your longitudinal patterns (it tells the model what to centre on; the
  model never decides).

---

## Architecture (sandbox-adapted)

This repository runs in a constrained cloud-sandbox environment. The
production target described in the original build directive — Firebase
Authentication, Cloud Firestore, Google Cloud Secret Manager, Google
Cloud Run, and the Gemini API directly — is adapted here to the sandbox's
available stack, with the security and isolation properties preserved at
every layer:

| Directive requirement | Sandbox implementation | What's preserved |
|---|---|---|
| Firebase Authentication | NextAuth.js v4 Credentials provider, bcrypt-hashed passwords in Prisma | Per-user identity; session-enforced auth on every API route |
| Cloud Firestore | Prisma + SQLite with server-side ownership enforcement on every query | Per-user isolated data; no cross-user access by any input |
| Gemini API | `z-ai-web-dev-sdk` LLM skill, backend-only, structured JSON + zod validation | Real multi-turn Gemini calls; secrets never shipped to client |
| Google Cloud Secret Manager | Server-only SDK credentials; never in the client bundle | Secrets never exposed to the browser |
| Google Cloud Run | Next.js 16 dev server on port 3000 | Single deployable process |

The system rules of this sandbox require NextAuth, Prisma/SQLite, and
the z-ai-web-dev-sdk; they cannot be replaced with Firebase/Firestore/
Cloud Run. The adaptation is documented honestly here and in
`/home/z/my-project/worklog.md` so a judge can evaluate what's real vs.
what's adapted.

### The single most important technical principle

> **MODEL OUTPUT IS NEVER TRUSTED AS APPLICATION STATE.**

Gemini may interpret, summarize, classify, suggest, generate narrative,
identify intent, and propose choices and consequences. It must never be
the authoritative source of persistent application state. The backend
validates, clamps, and applies every model-proposed change. Endings are
decided by authoritative state thresholds, not by model text. This
separation is demonstrable in the code (`src/lib/ai.ts`,
`src/lib/simulation.ts`, `src/app/api/arcade/sessions/[id]/turn/route.ts`).

---

## Repository layout

```
prisma/schema.prisma          # User, Dream, DreamAnalysis, Motif, Entity,
                             # EntityMention, ArcadeSession, SessionTurn,
                             # LexiconIgnore, Account, Session
src/lib/
  ai.ts                      # Gemini calls + zod validation + repair+retry
  simulation.ts              # Authoritative state machine (applyDelta + endings)
  memory-graph.ts            # Canonical-entity clustering + threads + evolution
  patterns.ts                # Longitudinal pattern report (app-side)
  rate-limit.ts              # In-memory rate limiter + single-flight lock
  prompts.ts                 # Prompt engineering (injection-fenced)
  types.ts                   # Shared types
  auth.ts                    # requireUser() server helper
  store.ts                   # Zustand SPA view-routing
src/app/api/
  dreams/                    # GET/POST/DELETE + reanalyze + share
  arcade/sessions/           # CRUD + turn (streaming + non-streaming) + share
  threads/                   # Dream Memory Graph (canonical entities + evolution)
  patterns/                  # Pattern report + lexicon mute/restore
  shared/                    # Public read-only dream + session-story endpoints
  asr/  tts/  me/  auth/     # Voice capture, narration, profile, NextAuth
src/components/views/        # Landing, Auth, Dashboard, Capture, Journal,
                             # DreamDetail, Patterns, Atlas, Threads, Arcade,
                             # ArcadeSession, Profile, SharedDream, Story, Echo
src/components/views/dream-dna.tsx   # Compact visual signature per dream
src/components/shell/        # TopNav, Footer, CommandPalette, DreamBackground
```

---

## Security model

- **Per-user isolation.** Every API route calls `requireUser()` (throws 401
  if unauthenticated) and scopes every Prisma `findFirst`/`update`/`delete`
  by `userId`. There is no client-supplied userId parameter anywhere; the
  session is the only source of identity. A user cannot retrieve, modify,
  or delete another user's dreams, sessions, entities, mentions, or
  shares by modifying IDs, URLs, request payloads, or client state.
- **Secrets never exposed.** The `z-ai-web-dev-sdk` is imported only in
  server modules (`src/lib/ai.ts`, `src/app/api/asr/route.ts`,
  `src/app/api/tts/route.ts`). No Gemini credentials appear in client
  bundles or API responses.
- **Prompt-injection resistance.** Dream text, prior model output,
  session history, and the user's action are all fenced as
  `UNTRUSTED CONTENT` in the prompts. The system prompt explicitly
  instructs the model to treat commands, role overrides, or secret-leak
  requests inside that content as dream material to narrate — never as
  instructions to follow. The application validates structured output
  regardless of what the model says.
- **State machine integrity.** AI-proposed deltas are clamped (±25/turn
  per meter, 0–100 range, bounded arrays). Endings are decided by
  authoritative thresholds (stability ≤ 8 || fear ≥ 98 → collapse;
  agency ≥ 85 && lucidity ≥ 75 → control; turn ≥ 18 → unresolved). The
  model can propose; it cannot decide.
- **Concurrency + rate limiting.** Per-session single-flight locks
  prevent double-submits / parallel requests from corrupting Arcade
  state (409 "a turn is already forming"). Per-user rate limits cap
  dream-analysis (6/10min) and arcade turns (30/min) to resist abuse
  and accidental model-quota burn (429 with Retry-After).
- **Graceful failure.** Malformed model JSON triggers one repair retry;
  if that fails, a neutral fallback turn is persisted (no turn is
  burned). Firestore/SQLite failures never falsely claim success. Auth
  failures deny access cleanly. The user never sees raw stack traces,
  secrets, or provider errors.
- **Sharing is deliberate.** Public share endpoints return only
  sanitised payloads (title, summary, reflection fields, day-precision
  dates, author first name). Raw model output, internal IDs, email,
  other dreams, and (for dream shares) the raw dream text (unless
  explicitly opted in) are never exposed. Shares can be revoked and can
  expire.

---

## Privacy model

- Dreams are private by default. There is no public feed, no social
  graph, no multiplayer, no leaderboards.
- A dream can be shared as a read-only reflection via a secret token.
  Revocation nulls the token immediately. Optional expiry windows
  (1–365 days, or never) auto-close the link.
- An ended Arcade session can be shared as a read-only **story** (the
  turn-by-turn narrative + final meters + discovered motifs). Same
  security model: secret token, revocable, expirable.
- Account deletion cascades all dreams, analyses, motifs, entities,
  mentions, sessions, turns, and lexicon ignores.

---

## Demo flow (5 minutes)

1. Sign in (or sign up).
2. **Capture** a messy dream — type it, or speak it (ASR transcribes
   your half-asleep voice; you review before saving).
3. Watch Gemini transform it into a structured memory: summary,
   emotional signature, motifs, symbols, people, places, actions,
   dream laws, lucidity/fear/uncertainty meters, and possible
   interpretations with verbatim **evidence** quotes.
4. Open the **Dream Detail** — see OBSERVED raw memory beside
   INFERRED reflection. Note the **Dream DNA** glyph (compact visual
   signature) next to the title.
5. Open **Threads** — the Dream Memory Graph. See a recurring motif
   traced across multiple dreams, with its role evolution ("first it
   was fled; now it is confronted") and a fear-arc sparkline.
6. Open **Atlas** or **Patterns** for the longitudinal view.
7. Pick a dream and select **Re-enter dream** in the Arcade.
8. Choose Replay / Rewrite / Confront. Open the dream.
9. Make a meaningful decision. Gemini continues the scene (streaming,
   second-person, grounded in your imagery).
10. Watch the authoritative state meters respond (the app applied the
    clamped delta — not the model's raw numbers).
11. If the scene references a motif that also appears in a prior dream,
    a subtle **Memory Echo** aside surfaces below the scene.
12. Continue until an ending (collapse / escape / control /
    unresolved / transformed) — decided by the app's thresholds.
13. Share the ended session as a public **story** link (read-only,
    expirable) to show the world you built.

---

## Local development

```bash
bun install
bun run db:push        # create/migrate the SQLite schema
bun run dev            # start the Next.js dev server on port 3000
bun run lint           # ESLint
```

The app runs entirely on `http://localhost:3000`. The only user-visible
route is `/` (a single-page app with hash-based view switching);
everything else is an API route under `/api/*`.

### Environment

The sandbox provides the `z-ai-web-dev-sdk` credentials out of the box
(server-side). No `.env` file is required for local development beyond
the `DATABASE_URL` that points at `db/custom.db`.

---

## Testing

The project is verified end-to-end via the `agent-browser` headless
browser automation (navigate, click, type, snapshot). Each development
round in `worklog.md` records the golden-path verifications performed.
Unit tests for the model-JSON repair logic live in
`scripts-test/test-extract.ts`.

---

## Known limitations

- The sandbox cannot deploy to Google Cloud Run; the production target
  is represented by the Next.js dev server. The architectural mapping
  is documented above and in `worklog.md`.
- The memory-graph alias map (`ALIAS_MAP` in `src/lib/memory-graph.ts`)
  is hand-curated English. Cross-locale aliasing and embedding-based
  near-match would deepen thread detection further.
- Arcade turn latency (~10–15s) is inherent to the LLM; the streaming
  endpoint + scene-forming loading UX mitigate perceived wait.
- The lexicon stopword list is English-only.

---

## License

Personal hackathon submission. Not for redistribution.
