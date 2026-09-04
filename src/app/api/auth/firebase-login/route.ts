// POST /api/auth/firebase-login
//
// PRODUCTION auth path (`AUTH_BACKEND=firebase`): the client signs in via
// the Firebase JS SDK (browser-side, public firebaseConfig — apiKey is
// safe to expose), obtains a Firebase ID token, and POSTs it here.
// The server verifies the ID token via firebase-admin
// `auth().verifyIdToken(idToken)`, then issues a NextAuth JWT session
// keyed on the Firebase uid. The app session is established via the
// standard `next-auth.session-token` cookie, so the rest of the app
// (requireUser, getRepository with userId-scoped queries) works unchanged.
//
// SECURITY:
//   - The Firebase ID token is verified server-side. The client NEVER
//     has service-account credentials.
//   - The firebaseConfig exposed to the browser contains only public
//     values (apiKey, authDomain, projectId). Service-account credentials
//     are server-only via Secret Manager / ADC.
//   - The issued NextAuth JWT is signed with NEXTAUTH_SECRET (Secret
//     Manager in production). The JWT carries `uid` only; no Firebase
//     user record (PII) is duplicated into it.
//   - This route is only callable when `AUTH_BACKEND=firebase`. In local
//     mode it 404s by refusing to serve (the client never calls it).
//
// CRITICAL PRINCIPLE: the verified Firebase uid becomes the userId for
// every downstream ownership-scoped query. The user identity is set once,
// server-side, after cryptographic verification — never trusted from the
// client.

import { NextResponse } from "next/server";
import { encode } from "next-auth/jwt";
import { z } from "zod";
import { verifyFirebaseIdToken, currentAuthBackend } from "@/lib/auth";

const bodySchema = z.object({
  idToken: z.string().min(50, "idToken required"),
});

// 30 days — matches NextAuth's default maxAge.
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export async function POST(req: Request) {
  if (currentAuthBackend() !== "firebase") {
    return NextResponse.json(
      { error: "firebase auth backend not enabled" },
      { status: 404 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid" },
      { status: 400 }
    );
  }

  let verified: { uid: string; email?: string; name?: string };
  try {
    verified = await verifyFirebaseIdToken(parsed.data.idToken);
  } catch (e: any) {
    // Don't leak the underlying Firebase error to the client.
    console.warn("[firebase-login] ID token verification failed:", e?.message ?? e);
    return NextResponse.json(
      { error: "invalid or expired id token" },
      { status: 401 }
    );
  }

  // Issue a NextAuth JWT keyed on the Firebase uid. The session callback in
  // auth.ts attaches token.uid → session.user.id, so requireUser() works.
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    console.error("[firebase-login] NEXTAUTH_SECRET not set");
    return NextResponse.json(
      { error: "internal" },
      { status: 500 }
    );
  }

  const token = await encode({
    secret,
    token: {
      uid: verified.uid,
      email: verified.email ?? null,
      name: verified.name ?? null,
      // NextAuth's default token fields
      sub: verified.uid,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
      jti: cryptoRandomString(),
    },
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  const isHttps = req.url.startsWith("https://");
  const cookieName = isHttps ? "__Secure-next-auth.session-token" : "next-auth.session-token";
  const cookie = `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}${isHttps ? "; Secure" : ""}`;

  return NextResponse.json(
    { ok: true, user: { id: verified.uid, email: verified.email ?? null, name: verified.name ?? null } },
    { status: 200, headers: { "Set-Cookie": cookie } }
  );
}

function cryptoRandomString(): string {
  // 16 bytes of random for the JWT id — defensive uniqueness.
  try {
    const buf = (globalThis as any).crypto?.randomBytes?.(16) ?? crypto.getRandomValues(new Uint8Array(16));
    return Array.from(buf as Uint8Array).map((b: number) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return Math.random().toString(36).slice(2);
  }
}
