// Server-side authentication.
//
// LOCAL path (default, `AUTH_BACKEND=nextauth`): NextAuth v4 Credentials
// provider, bcrypt-hashed passwords in Prisma. JWT sessions. This is the
// dev + sandbox QA path — zero cloud credentials needed.
//
// PRODUCTION path (`AUTH_BACKEND=firebase`): verify Firebase ID tokens
// server-side via firebase-admin `auth().verifyIdToken(idToken)`, then
// issue a NextAuth JWT session keyed on the Firebase uid. The client sends
// the Firebase ID token; the server verifies it; the app session is
// established via /api/auth/firebase-login.
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

// ---------- NextAuth (local path) ----------

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: {
    // We render auth inside the SPA, but keep this for direct hits.
    signIn: "/",
  },
  providers: [
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
  ],
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
  secret: process.env.NEXTAUTH_SECRET || "dreamweaver-dev-secret-change-me",
};

import { getServerSession } from "next-auth";

export async function getAuthSession() {
  // Both paths use the NextAuth session as the app session — the Firebase
  // path issues a NextAuth JWT after verifying the ID token in
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
  const admin = await import("firebase-admin");
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT,
    });
  }
  _firebaseAuth = admin.auth();
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
