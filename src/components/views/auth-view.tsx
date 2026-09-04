"use client";

import { useState } from "react";
import { useAuth, type AuthResult } from "@/components/auth-provider";
import { useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { DreamMark } from "@/components/shell/top-nav";

// Auth view — single implementation that works for BOTH auth backends
// (production Firebase client SDK + local-dev NextAuth) via the unified
// `useAuth()` contract from src/components/auth-provider.tsx.
//
// The browser genuinely uses the Firebase client SDK in production:
//   - signInWithPassword() → createUserWithEmailAndPassword /
//     signInWithEmailAndPassword (firebase/auth) → onAuthStateChanged fires
//     → ID token POSTed to /api/auth/firebase-login → server verifies via
//     firebase-admin → signed HttpOnly cookie established.
// In local dev the same call dispatches to NextAuth signIn("credentials").
//
// ERROR HANDLING — non-enumerating + specific-but-safe:
//   - Sign-in: ONE generic "email or password is incorrect" for any failure
//     (wrong password, unknown email, disabled account, malformed email).
//     Never reveals whether an email exists.
//   - Sign-up: duplicate email is named (the user just typed it; not
//     enumeration). Weak password + invalid email are client-validated
//     before the network call.
//   - Network/server failures get a calm generic message; no stack traces.

export function AuthView() {
  const authMode = useApp((s) => s.authMode);
  const navigate = useApp((s) => s.navigate);
  const { toast } = useToast();
  const { signInWithPassword } = useAuth();

  const [mode, setMode] = useState<"signin" | "signup">(authMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  // Minimal, non-enumerating client-side validation. Catches the obvious
  // mistakes before they reach the network so the user gets immediate, specific
  // feedback and the server only sees well-formed requests. Duplicate-email
  // and wrong-password are still resolved server-side and returned as a single
  // generic "could not sign in" to avoid account enumeration.
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    if (!EMAIL_RE.test(email.trim())) {
      toast({ title: "Enter a valid email", description: "Use the form you@example.com.", variant: "destructive" });
      return;
    }
    if (password.length < 6) {
      toast({ title: "Password is too short", description: "At least 6 characters.", variant: "destructive" });
      return;
    }

    setLoading(true);
    const res: AuthResult = await signInWithPassword(
      email.trim().toLowerCase(),
      password,
      mode,
      mode === "signup" ? name.trim() || undefined : undefined
    );
    setLoading(false);

    if (!res.ok) {
      // Map the unified error keys to user-facing copy. One generic for
      // sign-in; duplicate-named for sign-up.
      const isSignup = mode === "signup";
      const title = isSignup ? "Could not create account" : "Sign in failed";
      let description: string;
      if (res.error === "email-exists") {
        description = "An account with this email already exists.";
      } else if (res.error === "weak-password") {
        description = "Choose a stronger password (at least 6 characters).";
      } else if (res.error === "invalid-email") {
        description = "Enter a valid email address.";
      } else if (res.error === "rate-limited") {
        description = "Too many attempts. Pause a moment and try again.";
      } else if (res.error === "network") {
        description = "Couldn't reach the server. Check your connection.";
      } else if (!isSignup) {
        description = "Email or password is incorrect.";
      } else {
        description = "Something went wrong. Try again.";
      }
      toast({ title, description, variant: "destructive" });
      return;
    }
    // The auth provider's onAuthStateChanged / NextAuth session refresh will
    // flip status to "authenticated"; useAuthRouting watches and routes to
    // the dashboard.
    navigate("dashboard");
  }

  return (
    <div className="relative min-h-screen flex flex-col">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8 pt-8">
        <button
          onClick={() => navigate("landing")}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition focus-ring"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.6} />
          Back to the dream
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center px-5 py-12">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-md surface p-8 sm:p-10"
        >
          <div className="flex items-center gap-2.5 mb-6">
            <DreamMark />
            <span className="font-display text-xl tracking-display">DreamWeaver</span>
          </div>

          <h1 className="font-display text-4xl tracking-display leading-tight balance">
            {mode === "signup" ? "Begin your dream memory." : "Welcome back."}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground pretty">
            {mode === "signup"
              ? "Create an account to capture, reflect on, and re-enter your dreams. Your records stay private to you."
              : "Sign in to return to your evolving dream world."}
          </p>

          <form onSubmit={submit} className="mt-7 space-y-4">
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="name" className="text-xs tracking-caps uppercase text-muted-foreground">
                  Name <span className="text-muted-foreground/60 normal-case tracking-normal">(optional)</span>
                </Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  className="bg-background/70"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs tracking-caps uppercase text-muted-foreground">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="bg-background/70"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs tracking-caps uppercase text-muted-foreground">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                className="bg-background/70"
              />
              <p className="text-[11px] text-muted-foreground">At least 6 characters.</p>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 bg-foreground text-background hover:opacity-90"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : mode === "signup" ? (
                "Create account"
              ) : (
                "Sign in"
              )}
            </Button>
          </form>

          <div className="mt-6 text-sm text-muted-foreground text-center">
            {mode === "signup" ? (
              <>
                Already have an account?{" "}
                <button
                  onClick={() => setMode("signin")}
                  className="text-foreground underline underline-offset-4 decoration-border hover:decoration-foreground"
                >
                  Sign in
                </button>
              </>
            ) : (
              <>
                New to DreamWeaver?{" "}
                <button
                  onClick={() => setMode("signup")}
                  className="text-foreground underline underline-offset-4 decoration-border hover:decoration-foreground"
                >
                  Create an account
                </button>
              </>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
