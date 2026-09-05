// Server-side authentication.
//
// LOCAL path (default, `AUTH_BACKEND=nextauth`): NextAuth v4 Credentials
// provider, bcrypt-hashed passwords in Prisma. JWT sessions. This is the
// dev + sandbox QA path — zero cloud credentials needed.
//
// PRODUCTION path (`AUTH_BACKEND=firebase`): the browser signs in via the
// Firebase client SDK (firebase/auth), obtains a Firebase ID token, and
// POSTs it to /api/auth/firebase-login. That route verifies the ID token
// via `firebase-admin` `auth().verifyIdToken(idToken)`, then issues a
// signed NextAuth JWT cookie keyed on the verified Firebase uid. The rest
// of the app (`requireUser()`, ownership-scoped Repository queries) then
// works unchanged.
//
// CRITICAL: in production the Credentials provider is DISABLED entirely —
// the only way to obtain a session is via /api/auth/firebase-login after a
// cryptographically verified Firebase ID token. There is no credential-bypass
// path. One authoritative user identity: the verified Firebase uid.
//
//   - The client NEVER sees Firebase service-account keys. The client uses
//     the Firebase JS SDK with the public `firebaseConfig` (apiKey is public
//     and safe; service-account credentials are server-only via
//     Secret Manager / ADC).
//   - `requireUser()` works identically in both paths — returns the
//     verified userId, throws 401 otherwise.
//
// CRITICAL PRINCIPLE: auth is the source of truth for the userId. The
// routes never trust a client-supplied userId; they call requireUser()
// and the returned id drives every subsequent ownership-scoped query
// (in both the Prisma and Firestore adapters).

import type { NextAuthOptions } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { getRepository } from "@/lib/data/repository";

const credSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6, "Password must be at least 6 characters"),
  name: z.string().optional(),
  mode: z.enum(["signin", "signup"]).default("signin"),
});

function authBackend(): "nextauth" | "firebase" {
  return process.env.AUTH_BACKEND === "firebase" ? "firebase" : "nextauth";
}

// ---------- NextAuth options ----------
//
// In local-dev mode (AUTH_BACKEND=nextauth) the Credentials provider is
// enabled and is the source of identity (bcrypt-verified Prisma users).
//
// In production (AUTH_BACKEND=firebase) the Credentials provider is
// DISABLED (the providers array is empty). The only way to get a session
// is /api/auth/firebase-login, which verifies a Firebase ID token and
// issues a NextAuth JWT cookie. This means /api/auth/callback/credentials
// returns an error — there is no credential-bypass path into the app.
// The NextAuth JWT layer remains as the session cookie mechanism (the
// /api/auth/firebase-login route uses next-auth/jwt `encode()`), but
// NextAuth credentials auth is genuinely gone in production.

function buildAuthOptions(): NextAuthOptions {
  const providers: NextAuthOptions["providers"] =
    authBackend() === "nextauth"
      ? [
          Credentials({
            name: "Credentials",
            credentials: {
              email: { label: "Email", type: "email" },
              password: { label: "Password", type: "password" },
              name: { label: "Name", type: "text" },
              mode: { label: "Mode", type: "text" },
            },
            async authorize(raw) {
              const parsed = credSchema.safeParse(raw);
              if (!parsed.success) return null;
              const { email, password, name, mode } = parsed.data;
              const emailLc = email.trim().toLowerCase();

              const repo = await getRepository();

              if (mode === "signup") {
                const existing = await repo.user.findUnique({ where: { email: emailLc } });
                if (existing) return null; // already exists
                const hash = await bcrypt.hash(password, 12);
                const user = await repo.user.create({
                  data: { email: emailLc, name: name?.trim() || null, password: hash },
                });
                return { id: user.id, email: user.email, name: user.name } as any;
              }

              // signin
              const user = await repo.user.findUnique({ where: { email: emailLc } });
              if (!user) return null;
              const ok = await bcrypt.compare(password, user.password);
              if (!ok) return null;
              return { id: user.id, email: user.email, name: user.name } as any;
            },
          }),
        ]
      : // PRODUCTION: no credentials provider. Only /api/auth/firebase-login
        // can mint a session, and only after a verified Firebase ID token.
        [];

  return {
    session: { strategy: "jwt" },
    pages: {
      // We render auth inside the SPA, but keep this for direct hits.
      signIn: "/",
    },
    providers,
    callbacks: {
      async jwt({ token, user }) {
        if (user) {
          token.uid = (user as any).id;
          token.email = (user as any).email;
        }
        return token;
      },
      async session({ session, token }) {
        if (session.user) {
          (session.user as any).id = token.uid as string;
        }
        return session;
      },
    },
    // SECRET: NO insecure production fallback. In production
    // (AUTH_BACKEND=firebase) NEXTAUTH_SECRET MUST be set (via Secret
    // Manager) — if it is missing the server refuses to sign sessions
    // rather than silently using a known dev string. In local dev the
    // fallback is tolerated so `bun run dev` works out of the box
    // (the .env.example tells the developer to change it).
    secret: (() => {
      const s = process.env.NEXTAUTH_SECRET;
      if (s && s.length > 0) return s;
      if (authBackend() === "firebase") {
        // PRODUCTION: refuse to use a fallback. Every session cookie will
        // fail to verify (the encode/decode calls will throw) — better than
        // silently authenticating against a public string.
        console.error(
          "[auth] FATAL: NEXTAUTH_SECRET is not set in production (AUTH_BACKEND=firebase). Refusing to use a fallback secret."
        );
        return undefined;
      }
      // Local-dev fallback (clearly marked as insecure; .env.example
      // instructs the developer to override it).
      return "dreamweaver-dev-secret-change-me";
    })(),
  };
}

export const authOptions: NextAuthOptions = buildAuthOptions();

import { getServerSession } from "next-auth";

export async function getAuthSession() {
  // Both paths use the NextAuth session cookie as the app session — the
  // Firebase path issues a NextAuth JWT after verifying the ID token in
  // /api/auth/firebase-login (see that route). So this is the single
  // session resolver for both paths.
  return getServerSession(authOptions);
}

// Returns the authenticated user id, or null.
export async function getUserId(): Promise<string | null> {
  const s = await getAuthSession();
  return (s?.user as any)?.id ?? null;
}

// Throws a Response (caught by route handlers) when unauthenticated.
export async function requireUser(): Promise<string> {
  const id = await getUserId();
  if (!id) {
    const res = Response.json({ error: "unauthorized" }, { status: 401 });
    throw res;
  }
  return id;
}

// ---------- Firebase Auth verification (production path) ----------
//
// Used by /api/auth/firebase-login. Verifies a Firebase ID token and
// returns the verified user record (or throws). The route then issues a
// NextAuth JWT session keyed on the Firebase uid so the rest of the app
// (requireUser, getRepository with userId-scoped queries) works unchanged.
//
// Lazy-loaded: the firebase-admin SDK is only imported when
// AUTH_BACKEND === 'firebase', so local dev never pulls it in.

let _firebaseAuth: any = null;
async function firebaseAuth(): Promise<any> {
  if (_firebaseAuth) return _firebaseAuth;
  const { getApps, initializeApp, applicationDefault } = await import("firebase-admin/app");
  if (!getApps().length) {
    initializeApp({
      credential: applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT,
    } as any);
  }
  const { getAuth } = await import("firebase-admin/auth");
  _firebaseAuth = getAuth();
  return _firebaseAuth;
}

/** Verify a Firebase ID token server-side. Returns the verified uid (and
 *  the decoded token for richer claims if needed). Throws on invalid token.
 *  Only called when AUTH_BACKEND === 'firebase'. */
export async function verifyFirebaseIdToken(
  idToken: string
): Promise<{ uid: string; email?: string; name?: string }> {
  const auth = await firebaseAuth();
  const decoded = await auth.verifyIdToken(idToken);
  return {
    uid: decoded.uid,
    email: decoded.email ?? undefined,
    name: decoded.name ?? undefined,
  };
}

/** Returns the active auth backend, for the client to know where to send
 *  credentials. ('nextauth' → POST credentials to /api/auth/callback/
 *  credentials; 'firebase' → POST Firebase ID token to
 *  /api/auth/firebase-login.) */
export function currentAuthBackend(): "nextauth" | "firebase" {
  return authBackend();
}
