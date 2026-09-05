"use client";

// Unified authentication provider — the SINGLE auth surface the rest of
// the client app consumes via `useAuth()`.
//
// Two modes, selected at build time by `NEXT_PUBLIC_AUTH_BACKEND`:
//
//   • `firebase` (PRODUCTION) — the browser genuinely uses the Firebase
//     client SDK. The user signs in/up via Firebase Auth
//     (signInWithEmailAndPassword / createUserWithEmailAndPassword). The
//     Firebase JS SDK manages the user + ID token. On every auth-state
//     change, the provider POSTs the fresh ID token to
//     /api/auth/firebase-login, which verifies it via `firebase-admin`
//     `verifyIdToken()` and establishes the application session via a
//     signed HttpOnly cookie keyed on the VERIFIED Firebase uid. The
//     client never sees service-account credentials; the server never
//     trusts a client-supplied uid.
//
//   • `nextauth` (LOCAL DEV + SANDBOX QA) — wraps NextAuth's
//     SessionProvider + useSession() behind the same `useAuth()` interface.
//     Local dev needs zero Google Cloud credentials.
//
// CRITICAL: there is ONE authoritative user identity per backend:
//   - firebase  → the verified Firebase UID
//   - nextauth  → the Prisma user ID (cuid)
// Both are set server-side after cryptographic verification; the client
// never supplies a userId to any API route. `requireUser()` reads it from
// the verified session on every request.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  SessionProvider,
  useSession,
  signIn as nextAuthSignIn,
  signOut as nextAuthSignOut,
} from "next-auth/react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  fbSignOut,
  getFirebaseAuth,
  type FirebaseUser,
} from "@/lib/firebase/client";

export const AUTH_BACKEND = (process.env.NEXT_PUBLIC_AUTH_BACKEND ?? "nextauth") as
  | "firebase"
  | "nextauth";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

export interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
}

export interface AuthResult {
  ok: boolean;
  /** Non-enumerating, specific-but-safe error key. See maps in each provider. */
  error?: string;
}

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  /** Sign in OR sign up. Mode selects. Returns {ok, error}. */
  signInWithPassword: (
    email: string,
    password: string,
    mode: "signin" | "signup",
    name?: string
  ) => Promise<AuthResult>;
  /** Sign out of both the auth backend (Firebase/NextAuth) AND the app session. */
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

// ---------------------------------------------------------------------------
// FIREBASE provider (production)
// ---------------------------------------------------------------------------

function FirebaseAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  // Ref guard so we don't re-POST the same token to /firebase-login on
  // repeated onAuthStateChanged fires for the same user (the callback is
  // registered once and closes over this ref, so it stays current).
  const lastTokenRef = useRef<string>("");

  useEffect(() => {
    let unsub = () => {};
    try {
      const auth = getFirebaseAuth();
      unsub = onAuthStateChanged(auth, async (fbUser: FirebaseUser | null) => {
        if (!fbUser) {
          setUser(null);
          setStatus("unauthenticated");
          lastTokenRef.current = "";
          return;
        }
        // Get a fresh ID token and POST it to the server to establish the
        // app session (server verifies via firebase-admin, sets signed
        // HttpOnly cookie). This is the genuine Firebase client auth path.
        try {
          const idToken = await fbUser.getIdToken();
          // Avoid re-POSTing when the token hasn't rotated (onAuthStateChanged
          // can fire multiple times for the same user during a session).
          if (idToken === lastTokenRef.current) return;
          const res = await fetch("/api/auth/firebase-login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ idToken }),
          });
          if (res.ok) {
            const data = await res.json();
            lastTokenRef.current = idToken;
            setUser(data.user);
            setStatus("authenticated");
          } else {
            // Server rejected the token (expired / revoked / mismatch). Sign
            // the user out of Firebase so the UI doesn't lie about state.
            try { await fbSignOut(auth); } catch {}
            setUser(null);
            setStatus("unauthenticated");
          }
        } catch {
          // Network/server failure — keep Firebase signed-in but mark app
          // unauthenticated so the UI doesn't claim a session that doesn't
          // exist. The next successful onAuthStateChanged will retry.
          setUser(null);
          setStatus("unauthenticated");
        }
      });
    } catch (e) {
      // Firebase client not configured (missing NEXT_PUBLIC_FIREBASE_*).
      // Fail safely to unauthenticated so the user sees the auth view.
      queueMicrotask(() => setStatus("unauthenticated"));
    }
    return () => unsub();
  }, []);

  const signInWithPassword: AuthContextValue["signInWithPassword"] = async (
    email,
    password,
    mode,
    name
  ) => {
    try {
      const auth = getFirebaseAuth();
      if (mode === "signup") {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        if (name) {
          try { await updateProfile(cred.user, { displayName: name }); } catch {}
        }
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      // onAuthStateChanged will fire → POST to /firebase-login → setStatus.
      return { ok: true };
    } catch (e: any) {
      // Map Firebase error codes to specific-but-non-enumerating messages.
      // We never reveal whether an email exists; sign-in uses a single
      // generic "credentials" error. Sign-up duplicate is named (the user
      // typed it; not enumeration).
      const code = e?.code ?? "unknown";
      let error = "unknown";
      if (mode === "signup") {
        if (code === "auth/email-already-in-use") error = "email-exists";
        else if (code === "auth/invalid-email") error = "invalid-email";
        else if (code === "auth/weak-password") error = "weak-password";
        else if (code === "auth/network-request-failed") error = "network";
        else error = "unknown";
      } else {
        if (
          code === "auth/invalid-credential" ||
          code === "auth/wrong-password" ||
          code === "auth/user-not-found" ||
          code === "auth/invalid-email" ||
          code === "auth/user-disabled" ||
          code === "auth/operation-not-allowed"
        ) {
          // All credential failures → one generic message (no enumeration).
          error = "invalid-credentials";
        } else if (code === "auth/too-many-requests") {
          error = "rate-limited";
        } else if (code === "auth/network-request-failed") {
          error = "network";
        } else {
          error = "unknown";
        }
      }
      return { ok: false, error };
    }
  };

  const signOut: AuthContextValue["signOut"] = async () => {
    try {
      const auth = getFirebaseAuth();
      // Firebase sign-out fires onAuthStateChanged(null) which the listener
      // can't use to clear the SERVER cookie (we only POST idToken when a
      // user exists). So we explicitly clear the server session here.
      await fbSignOut(auth);
    } catch {}
    try {
      await fetch("/api/auth/firebase-signout", { method: "POST" });
    } catch {}
    setUser(null);
    setStatus("unauthenticated");
    lastTokenRef.current = "";
  };

  const value: AuthContextValue = { status, user, signInWithPassword, signOut };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ---------------------------------------------------------------------------
// NEXTAUTH provider (local dev + sandbox QA)
// ---------------------------------------------------------------------------

function NextAuthSessionBridge({ children }: { children: ReactNode }) {
  const { status: naStatus, data: session, update: refresh } = useSession();
  const user: AuthUser | null = useMemo(() => {
    if (naStatus !== "authenticated") return null;
    const u = (session?.user as any) ?? null;
    if (!u) return null;
    return { id: u.id, email: u.email ?? null, name: u.name ?? null };
  }, [naStatus, session]);

  const status: AuthStatus =
    naStatus === "loading" ? "loading" : naStatus === "authenticated" ? "authenticated" : "unauthenticated";

  const signInWithPassword: AuthContextValue["signInWithPassword"] = async (
    email,
    password,
    mode,
    name
  ) => {
    // NextAuth credentials path. signIn() returns a result with .error on
    // failure. The server returns a single generic CredentialsSignin for any
    // failure, so we surface one error key for sign-in (no enumeration) and a
    // duplicate-specific key for sign-up (the user just typed the email).
    const res = await nextAuthSignIn("credentials", {
      email,
      password,
      name: mode === "signup" ? name : undefined,
      mode,
      redirect: false,
    });
    if (res?.error) {
      return {
        ok: false,
        error: mode === "signup" ? "email-exists" : "invalid-credentials",
      };
    }
    // Force the session provider to refresh in-place so status flips to
    // "authenticated" without a hard page reload.
    try { await refresh(); } catch {}
    return { ok: true };
  };

  const signOut: AuthContextValue["signOut"] = async () => {
    try { await nextAuthSignOut({ redirect: false }); } catch {}
  };

  const value: AuthContextValue = { status, user, signInWithPassword, signOut };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ---------------------------------------------------------------------------
// Outer selector
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: ReactNode }) {
  if (AUTH_BACKEND === "firebase") {
    return <FirebaseAuthProvider>{children}</FirebaseAuthProvider>;
  }
  // Local path: SessionProvider must wrap the NextAuth consumer so useSession
  // works.
  return (
    <SessionProvider>
      <NextAuthSessionBridge>{children}</NextAuthSessionBridge>
    </SessionProvider>
  );
}
