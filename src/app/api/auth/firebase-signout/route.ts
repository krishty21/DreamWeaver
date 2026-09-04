// POST /api/auth/firebase-signout
//
// PRODUCTION auth path (`AUTH_BACKEND=firebase`): the client has just
// called `signOut()` on the Firebase client SDK. Firebase's local auth
// state is gone, but the SERVER-side session cookie (the NextAuth JWT
// issued by /api/auth/firebase-login) is still present until it expires.
// This route clears that cookie so the next /api/me call returns
// `{ user: null }` and `requireUser()` throws 401.
//
// SECURITY:
//   - No body parsing, no auth required to CALL this (signing out is
//     idempotent and safe — you can't "sign out" someone else; you can
//     only clear the cookie on the response to YOUR request).
//   - Only callable when `AUTH_BACKEND === 'firebase'`. In local mode
//     the client uses NextAuth's /api/auth/signout, so this 404s.
//   - The cleared cookie is HttpOnly + SameSite=Lax (+ Secure on https).

import { NextResponse } from "next/server";
import { currentAuthBackend } from "@/lib/auth";

export async function POST(req: Request) {
  if (currentAuthBackend() !== "firebase") {
    return NextResponse.json(
      { error: "firebase auth backend not enabled" },
      { status: 404 }
    );
  }

  const isHttps = req.url.startsWith("https://");
  const cookieName = isHttps
    ? "__Secure-next-auth.session-token"
    : "next-auth.session-token";
  // Expire immediately, same path/domain attributes as the set cookie.
  const expires = "Expires=Thu, 01 Jan 1970 00:00:00 GMT";
  const cookie = `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; ${expires}${isHttps ? "; Secure" : ""}`;

  return NextResponse.json(
    { ok: true },
    { status: 200, headers: { "Set-Cookie": cookie } }
  );
}
