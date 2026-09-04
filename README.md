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

## Architecture (dual-adapter; production-ready + local-QA)

DreamWeaver runs on a **dual data + AI + auth stack** switchable via
environment variables. The local dev + sandbox QA path needs ZERO
Google Cloud credentials. The production path uses the real Google
stack (Firestore, Firebase Auth, Gemini-direct, Secret Manager, Cloud
Run) with official SDKs.

| Layer | Local + sandbox QA | Production (Google Cloud Run) | Switch env |
|---|---|---|---|
| Data | Prisma + SQLite | `firebase-admin` Firestore | `DATA_BACKEND` (`sqlite` \| `firestore`) |
| AI | `z-ai-web-dev-sdk` | `@google/genai` direct | `AI_BACKEND` (`zai` \| `gemini`) |
| Auth | NextAuth v4 Credentials + bcrypt | Firebase Auth (ID-token verify → NextAuth JWT) | `AUTH_BACKEND` (`nextauth` \| `firebase`) |
| Secrets | `process.env` | `@google-cloud/secret-manager` | `SECRETS_BACKEND` (`env` \| `gsm`) |
| Hosting | `next dev` on :3000 | Cloud Run (managed) | n/a |

Both paths implement the **same** `Repository` interface (`src/lib/data/repository.ts`)
and the **same** `AIBackend` interface (`src/lib/ai/registry.ts`). The API
routes call `getRepository()` / `getAI()` once at the top of the request
and the active backend is wired transparently. Response shapes are
identical; the routes do not know which backend served the request.

### The single most important technical principle

> **MODEL OUTPUT IS NEVER TRUSTED AS APPLICATION STATE.**

Gemini may interpret, summarize, classify, suggest, generate narrative,
identify intent, and propose choices and consequences. It must never be
the authoritative source of persistent application state. The backend
validates, clamps, and applies every model-proposed change. Endings are
decided by authoritative state thresholds, not by model text. This
separation is demonstrable in the code:

- `src/lib/ai/shared.ts` — zod schemas + clamp + repair logic shared by
  both AI backends (zai + gemini). Every model output passes through
  `analysisSchema.parse` / `turnSchema.parse`, then through post-parse
  shape helpers that clamp numeric ranges, truncate strings, and
  normalise labels.
- `src/lib/simulation.ts` — the authoritative Arcade state machine.
  `applyDelta()` clamps AI-proposed deltas to ±25/turn per meter and
  0–100 ranges; `ending` is decided by authoritative thresholds
  (`stability ≤ 8 || fear ≥ 98 → collapse`; `agency ≥ 85 && lucidity ≥
  75 → control`; `turn ≥ 18 → unresolved`).
- `src/app/api/dreams/route.ts` (POST) — the route computes
  `historicalConnections` app-side from prior motifs (the model is
  explicitly told NOT to include that field), then writes the analysis.
- `src/app/api/arcade/sessions/[id]/turn/route.ts` — the route passes
  the model's `proposedDelta` through `applyDelta()`; the model can
  propose, never decide.

### Repository contract — ownership scoping

Both adapters enforce per-user isolation in every query:

- **Prisma adapter** — passes `where.userId` through to Prisma. The
  routes already scope every `findFirst` / `update` / `delete` by
  `userId`; the userId comes from `requireUser()` (verified NextAuth
  session) or `verifyFirebaseIdToken()` (verified Firebase ID token),
  never from the client.
- **Firestore adapter** — reads `where.userId` (or `data.userId` on
  create) from the args and applies it as a composite filter on every
  user-scoped collection. If `userId` is missing on a user-scoped
  operation, the adapter throws (the only safe assumption is "the route
  forgot to scope it"). A user cannot retrieve or modify another user's
  records by any input — the composite filter excludes foreign rows
  even if the client supplied a foreign id.

### Public-by-token reads (sharing)

The two public share endpoints (`/api/shared/[token]` for dreams,
`/api/shared/session/[token]` for arcade stories) call
`dream.findFirst({ where: { shareToken } })` and
`arcadeSession.findFirst({ where: { shareToken } })` WITHOUT a userId.
These are the only user-scoped methods allowed to omit userId — the
share token is the unguessable secret (48 hex chars); possession grants
read access to that one sanitised payload only. The routes never expose
raw model output, internal ids, the dreamer's email, or any other
dream/session.

---

## Repository layout

```
prisma/schema.prisma          # User, Dream, DreamAnalysis, Motif, Entity,
                             # EntityMention, ArcadeSession, SessionTurn,
                             # LexiconIgnore, Account, Session
src/lib/
  data/
    repository.ts             # The Repository contract + getRepository() factory
    prisma-adapter.ts         # Local path: delegates to PrismaClient
    firestore-adapter.ts      # Production path: firebase-admin Firestore
  ai/
    registry.ts               # AIBackend interface + getAI() factory
    shared.ts                 # zod schemas + clamp + repair (used by both backends)
    zai-backend.ts            # Local path: z-ai-web-dev-sdk
    gemini-backend.ts         # Production path: @google/genai direct
  ai.ts                      # Public entrypoint — thin delegator to getAI()
  simulation.ts               # Authoritative state machine (applyDelta + endings)
  memory-graph.ts             # Canonical-entity clustering + threads + evolution
  patterns.ts                 # Longitudinal pattern report (app-side)
  rate-limit.ts               # In-memory rate limiter + single-flight lock
  prompts.ts                  # Prompt engineering (injection-fenced)
  types.ts                    # Shared types
  auth.ts                     # requireUser() — works for both auth backends
  secrets.ts                  # getSecret() — env | Secret Manager
  store.ts                    # Zustand SPA view-routing
src/app/api/
  dreams/                     # GET/POST/DELETE + reanalyze + share
  arcade/sessions/            # CRUD + turn (streaming + non-streaming) + share
  threads/                    # Dream Memory Graph (canonical entities + evolution)
  patterns/                   # Pattern report + lexicon mute/restore
  shared/                     # Public read-only dream + session-story endpoints
  asr/  tts/  me/  auth/      # Voice capture, narration, profile, NextAuth + Firebase login
  auth/firebase-login/        # POST — verify Firebase ID token, issue NextAuth JWT
deploy/cloud-run.yaml         # Cloud Run service manifest
cloudbuild.yaml               # Cloud Build pipeline (build, push, deploy)
Dockerfile                    # Multi-stage Next.js 16 standalone (non-root, port 8080)
.env.example                  # PLACEHOLDERS ONLY — copy to .env
src/components/views/        # Landing, Auth, Dashboard, Capture, Journal,
                             # DreamDetail, Patterns, Atlas, Threads, Arcade,
                             # ArcadeSession, Profile, SharedDream, Story, Echo
src/components/views/dream-dna.tsx   # Compact visual signature per dream
src/components/shell/        # TopNav, Footer, CommandPalette, DreamBackground
```

---

## Security model

- **Per-user isolation.** Every API route calls `requireUser()` (throws
  401 if unauthenticated) and scopes every Repository query by `userId`.
  There is no client-supplied userId parameter anywhere; the session is
  the only source of identity. A user cannot retrieve, modify, or
  delete another user's dreams, sessions, entities, mentions, or shares
  by modifying IDs, URLs, request payloads, or client state. The
  Firestore adapter enforces this with composite filters; the Prisma
  adapter passes through the same scoping the routes already do.
- **Secrets never exposed.** Server-only SDK credentials live in Secret
  Manager (production) or `process.env` (local). The `@google/genai`
  backend reads `GEMINI_API_KEY` via `getSecret()` — never from the
  client bundle. The Firebase JS SDK uses only the public
  `firebaseConfig` (apiKey is safe to expose); service-account
  credentials are server-only via ADC.
- **Prompt-injection resistance.** Dream text, prior model output,
  session history, and the user's action are all fenced as
  `UNTRUSTED CONTENT` in the prompts. The system prompt explicitly
  instructs the model to treat commands, role overrides, or secret-leak
  requests inside that content as dream material to narrate — never as
  instructions to follow. The application validates structured output
  regardless of what the model says.
- **State machine integrity.** AI-proposed deltas are clamped (±25/turn
  per meter, 0–100 range, bounded arrays). Endings are decided by
  authoritative thresholds (`stability ≤ 8 || fear ≥ 98 → collapse`;
  `agency ≥ 85 && lucidity ≥ 75 → control`; `turn ≥ 18 → unresolved`).
  The model can propose; it cannot decide.
- **Concurrency + rate limiting.** Per-session single-flight locks
  prevent double-submits / parallel requests from corrupting Arcade
  state (409 "a turn is already forming"). Per-user rate limits cap
  dream-analysis (6/10min) and arcade turns (30/min) to resist abuse
  and accidental model-quota burn (429 with Retry-After).
- **Graceful failure.** Malformed model JSON triggers one repair retry;
  if that fails, a neutral fallback turn is persisted (no turn is
  burned). Repository errors are wrapped into `{ error: "internal" }`
  with 500 status — no Prisma/Firestore error text or stack traces
  leak to the client. Auth failures deny access cleanly. The user
  never sees raw stack traces, secrets, or provider errors.
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
# Copy the placeholder env and set NEXTAUTH_SECRET
cp .env.example .env
# Generate a 32-byte base64 secret:
openssl rand -base64 32
# Paste the value into NEXTAUTH_SECRET in .env
bun run db:push        # create/migrate the SQLite schema (empty)
bun run dev            # start the Next.js dev server on port 3000
bun run lint           # ESLint
```

Local dev needs ZERO Google Cloud credentials. The default env values
(`DATA_BACKEND=sqlite`, `AI_BACKEND=zai`, `AUTH_BACKEND=nextauth`,
`SECRETS_BACKEND=env`) wire the local + sandbox QA path: Prisma +
SQLite + z-ai-web-dev-sdk (auto-resolved SDK credentials) + NextAuth
Credentials + env secrets.

The app runs entirely on `http://localhost:3000`. The only user-visible
route is `/` (a single-page app with hash-based view switching);
everything else is an API route under `/api/*`.

After `bun run db:push` the local SQLite DB is **empty** — there is no
seeded demo account. Sign up via the Auth view to test the full local
flow.

### Environment

See `.env.example` for the full placeholder list. For local dev you
only need the four `*_BACKEND` defaults + `DATABASE_URL` +
`NEXTAUTH_SECRET` + `NEXTAUTH_URL`. The `GEMINI_API_KEY` /
`FIREBASE_*` placeholders are only needed when you switch the
corresponding backend to `gemini` / `firestore` / `firebase` / `gsm`.

---

## Production deployment (Cloud Run)

The Dockerfile + `cloudbuild.yaml` + `deploy/cloud-run.yaml` are
real, deployable specs. The build pipeline:

1. `Dockerfile` — multi-stage Next.js 16 standalone build (deps →
   build → runner). Runs as non-root user `dreamweaver`, exposes port
   8080. The runtime SA provides ADC; no service-account JSON in the
   image.
2. `cloudbuild.yaml` — Cloud Build steps:
   - Build the image with the multi-stage Dockerfile.
   - Push to Artifact Registry
     (`${_REGION}-docker.pkg.dev/${_FIREBASE_PROJECT_ID}/${_AR_REPO}/${_SERVICE_NAME}`).
   - Deploy to Cloud Run with `--service-account` (the runtime SA),
     `--set-env-vars` (DATA_BACKEND=firestore, AI_BACKEND=gemini,
     AUTH_BACKEND=firebase, SECRETS_BACKEND=gsm,
     FIREBASE_PROJECT_ID, GCLOUD_PROJECT, NEXTAUTH_URL), and
     `--set-secrets` (NEXTAUTH_SECRET, GEMINI_API_KEY from Secret
     Manager). Min instances 0, concurrency 80, 1 cpu / 1Gi.
3. `deploy/cloud-run.yaml` — the Cloud Run service manifest as a YAML
   resource (apply with `gcloud run services replace`). Includes the
   `cloudrun.secrets` `secretKeyRef` for both secrets, the env vars
   for the four backend switches, and startup/liveness probes on
   `/api/me`.

Required IAM roles on the runtime service account
(`dreamweaver-runner@YOUR_PROJECT.iam.gserviceaccount.com`):

- `roles/datastore.user` — Firestore R/W + queries
- `roles/firebaseauth.admin` — verify ID tokens (or a more narrowly
  scoped custom role)
- `roles/secretmanager.secretAccessor` — NEXTAUTH_SECRET, GEMINI_API_KEY
- `roles/artifactregistry.reader` — pull the built image

The Firebase JS SDK is initialised in the browser with the public
`firebaseConfig` (apiKey is safe to expose). The client signs in via
Firebase, obtains an ID token, POSTs it to `/api/auth/firebase-login`,
which verifies it via `firebase-admin` and issues a NextAuth JWT
session keyed on the Firebase uid. From that point the rest of the
app (`requireUser()`, ownership-scoped queries) is identical to the
local path.

To deploy:

```bash
# Prerequisite: enable APIs, create the AR repo, create the SA, grant
# the IAM roles above, create the secrets in Secret Manager, and
# populate the substitutions in cloudbuild.yaml.

# Trigger a build:
gcloud builds submit --config=cloudbuild.yaml \
  --substitutions=_REGION=us-central1,_SERVICE_NAME=dreamweaver,\
_AR_REPO=dreamweaver,_RUNNER_SA=dreamweaver-runner@YOUR_PROJECT.iam.gserviceaccount.com,\
_FIREBASE_PROJECT_ID=YOUR_PROJECT,_NEXTAUTH_SECRET_SM=NEXTAUTH_SECRET,\
_GEMINI_API_KEY_SM=GEMINI_API_KEY
```

---

## Testing

The project is verified end-to-end via the `agent-browser` headless
browser automation (navigate, click, type, snapshot). Each
development round in `worklog.md` records the golden-path verifications
performed.

Unit-test coverage for the model-JSON repair logic lives in
`scripts-test/test-extract.ts`.

---

## Known limitations (honest)

- **The Google-stack production path (Firestore / Firebase Auth /
  Gemini-direct / Secret Manager / Cloud Run) is real code with the
  official SDKs and is deployable, but in this sandbox it was
  runtime-verified only on the local SQLite / z-ai-web-dev-sdk /
  NextAuth path.** No Google Cloud credentials exist in the sandbox;
  the production path was not exercised against live Google Cloud.
  The Firestore adapter, the @google/genai backend, the Secret
  Manager client, the firebase-login route, the Dockerfile, and the
  Cloud Build/Run manifests all compile and conform to the official
  SDK APIs, but final runtime verification requires real credentials
  at deploy time.
- The Firestore adapter's `tx()` method uses per-method atomic write
  batches (Firestore writeBatch) rather than a true cross-write
  transaction with read-your-writes. For the routes that use it
  (dream create + analysis + motifs), the per-method atomicity is
  sufficient; a true cross-write Firestore transaction is a future
  enhancement.
- The memory-graph alias map (`ALIAS_MAP` in `src/lib/memory-graph.ts`)
  is hand-curated English. Cross-locale aliasing and embedding-based
  near-match would deepen thread detection further.
- Arcade turn latency (~10–15s) is inherent to the LLM; the streaming
  endpoint + scene-forming loading UX mitigate perceived wait.
- The lexicon stopword list is English-only.

---

## License

Personal hackathon submission. Not for redistribution.
