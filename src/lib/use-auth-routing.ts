"use client";

import { useSession } from "next-auth/react";
import { useEffect } from "react";
import { useApp } from "@/lib/store";

// Hook that maps the current auth status onto the active view.
// - When unauthenticated, force view to "landing" or "auth".
// - When authenticated, redirect away from "landing"/"auth" to "dashboard".
export function useAuthRouting() {
  const { status } = useSession();
  const view = useApp((s) => s.view);
  const navigate = useApp((s) => s.navigate);

  useEffect(() => {
    if (status === "loading") return;
    if (status === "unauthenticated") {
      if (view !== "landing" && view !== "auth") {
        navigate("landing");
      }
    } else if (status === "authenticated") {
      if (view === "landing" || view === "auth") {
        navigate("dashboard");
      }
    }
  }, [status]);
}
