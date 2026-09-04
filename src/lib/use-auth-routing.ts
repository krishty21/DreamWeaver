"use client";

import { useEffect } from "react";
import { useAuth } from "@/components/auth-provider";
import { useApp } from "@/lib/store";

// Hook that maps the current auth status onto the active view.
// - When unauthenticated, force view to "landing", "auth", or "shared"
//   (the shared reflection is a public read-only view).
// - When authenticated, redirect away from "landing"/"auth" to "dashboard".
//
// This is backend-agnostic: `useAuth()` resolves to Firebase client auth
// (production) or NextAuth's useSession (local dev) behind the same contract.
export function useAuthRouting() {
  const { status } = useAuth();
  const view = useApp((s) => s.view);
  const navigate = useApp((s) => s.navigate);

  useEffect(() => {
    if (status === "loading") return;
    if (status === "unauthenticated") {
      // Public views a signed-out visitor may reach: landing, auth, and the
      // two read-only public share surfaces (shared reflection + session story).
      // Everything else is private and must redirect to landing.
      if (view !== "landing" && view !== "auth" && view !== "shared" && view !== "story") {
        navigate("landing");
      }
    } else if (status === "authenticated") {
      if (view === "landing" || view === "auth") {
        navigate("dashboard");
      }
    }
  }, [status, view, navigate]);
}
