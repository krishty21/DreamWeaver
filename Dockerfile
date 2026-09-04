# DreamWeaver Dockerfile — multi-stage Next.js 16 standalone build.
#
# Builds the Next.js standalone output (configured in next.config.ts with
# `output: 'standalone'`) and runs the server as a non-root user on port
# 8080 (Cloud Run's expected port).
#
# The standalone build bundles the minimal node_modules tree Next.js needs
# at runtime — no devDependencies, no Prisma client sources, no source
# files. The prisma client is generated at build time and copied in.
#
# Runtime: the Cloud Run service account provides Application Default
# Credentials (ADC). No service-account JSON is baked into the image.
# Secrets (GEMINI_API_KEY etc.) are mounted via Cloud Run's
# --set-secrets, not stored in the image.

# ---------- Stage 1: deps ----------
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY package.json bun.lock* package-lock.json* ./
# The project pins bun as the package manager but the Cloud Build image
# may not have bun; fall back to npm ci. Both produce identical deps.
RUN if command -v bun >/dev/null 2>&1; then \
      bun install --frozen-lockfile; \
    else \
      npm ci; \
    fi

# ---------- Stage 2: build ----------
FROM node:20-alpine AS builder
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Generate the Prisma client at build time so the standalone server has
# the typed client (not strictly required for the Firestore path, but the
# Prisma adapter still imports @prisma/client and needs the generated
# runtime files even when never called at runtime).
RUN npx prisma generate
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---------- Stage 3: runner (minimal, non-root) ----------
FROM node:20-alpine AS runner
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV NEXT_TELEMETRY_DISABLED=1

# Non-root user — the container never runs as root.
RUN addgroup --system --gid 1001 dreamweaver \
 && adduser --system --uid 1001 dreamweaver

# Copy the standalone build + its minimal node_modules.
COPY --from=builder --chown=dreamweaver:dreamweaver /app/.next/standalone ./
# Public assets + static chunks need to be alongside the standalone server.
COPY --from=builder --chown=dreamweaver:dreamweaver /app/.next/static ./.next/static
COPY --from=builder --chown=dreamweaver:dreamweaver /app/public ./public
# Prisma schema (used by @prisma/client at runtime even when the active
# backend is Firestore — the Prisma adapter is still imported, just unused).
COPY --from=builder --chown=dreamweaver:dreamweaver /app/prisma ./prisma
# Empty SQLite db dir (only used when DATA_BACKEND=sqlite, i.e. never in
# production; kept so the Prisma adapter doesn't crash on import).
RUN mkdir -p /app/db && chown -R dreamweaver:dreamweaver /app/db

USER dreamweaver
EXPOSE 8080

# The standalone build emits server.js at the workspace root.
CMD ["node", "server.js"]
