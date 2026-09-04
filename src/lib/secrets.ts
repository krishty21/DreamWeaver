// Server-side secret resolution.
//
// PRODUCTION path (`SECRETS_BACKEND=gsm` OR `DATA_BACKEND=firestore`):
//   reads `projects/<projectId>/secrets/<name>/versions/latest` via
//   `@google-cloud/secret-manager`. projectId from FIREBASE_PROJECT_ID or
//   GCLOUD_PROJECT env. Cached in-memory per-process.
//
// LOCAL path (default): reads `process.env[name]`. Zero cloud credentials
//   needed for local dev + sandbox QA.
//
// SECURITY:
//   - Never log secret values. Only their length / first-4 chars (for debug).
//   - Never ship secrets to the client. Only call getSecret() from server
//     modules (api routes, lib/ai/*).
//   - The .env.example uses PLACEHOLDERS ONLY — no real keys.
//   - In production, the Cloud Run runtime service account has
//     `roles/secretmanager.secretAccessor` and resolves secrets via ADC.
//
// The contract: returns string | undefined (undefined = not found).
// Callers (e.g. gemini-backend) treat undefined as "not configured" and
// surface a clear error rather than silently degrading.

import type { SecretManagerServiceClient } from "@google-cloud/secret-manager";

const _cache = new Map<string, string | undefined>();

let _smc: SecretManagerServiceClient | null | undefined;

async function gsmClient(): Promise<SecretManagerServiceClient | null> {
  if (_smc !== undefined) return _smc;
  // Dynamic import — never load @google-cloud/secret-manager in local mode
  // unless explicitly asked.
  try {
    const mod = await import("@google-cloud/secret-manager");
    _smc = new mod.SecretManagerServiceClient({
      projectId: process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT,
    });
    return _smc;
  } catch (e) {
    console.warn("[secrets] Secret Manager SDK unavailable:", e);
    _smc = null;
    return null;
  }
}

function isGsm(): boolean {
  if (process.env.SECRETS_BACKEND === "gsm") return true;
  // Implicit production mode: if we're on Firestore, secrets come from GSM.
  if (process.env.DATA_BACKEND === "firestore") return true;
  return false;
}

function projectId(): string | undefined {
  return process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
}

/**
 * Returns the resolved secret value, or `undefined` if not found.
 *
 * Production (gsm): resolves via Google Cloud Secret Manager, with the
 * Cloud Run runtime service account's ADC. Cached per-process.
 *
 * Local (default): reads process.env[name]. Cached per-process.
 *
 * Never log the value — only its presence/length for debug purposes.
 */
export async function getSecret(name: string): Promise<string | undefined> {
  if (_cache.has(name)) return _cache.get(name);
  let value: string | undefined;

  if (isGsm()) {
    const client = await gsmClient();
    const pid = projectId();
    if (client && pid) {
      try {
        const [ver] = await client.accessSecretVersion({
          name: `projects/${pid}/secrets/${name}/versions/latest`,
        });
        const payload = ver.payload?.data;
        value =
          payload == null
            ? undefined
            : typeof payload === "string"
              ? payload
              : Buffer.from(payload as Uint8Array).toString("utf-8");
      } catch (e: any) {
        console.warn(
          `[secrets] could not access ${name} via Secret Manager:`,
          e?.message ?? e
        );
        value = undefined;
      }
    } else if (!client) {
      console.warn(`[secrets] GSM backend selected but client unavailable; falling back to env for ${name}`);
    } else if (!pid) {
      console.warn(`[secrets] GSM backend selected but FIREBASE_PROJECT_ID / GCLOUD_PROJECT unset; falling back to env for ${name}`);
    }
  }

  if (value === undefined) {
    // Always include env as a fallback (local dev, plus production-side
    // overrides when a deployer prefers to inline a secret rather than
    // register it in GSM).
    value = process.env[name];
  }

  _cache.set(name, value);
  return value;
}

/** Test/debug helper — exposes the length of a resolved secret so a health
 *  endpoint can confirm it's set without leaking the value. */
export async function getSecretLength(name: string): Promise<number> {
  const v = await getSecret(name);
  return v ? v.length : 0;
}

/** Test-only: clear the in-memory cache (used by tests / warm-restart). */
export function __clearSecretCache(): void {
  _cache.clear();
}
