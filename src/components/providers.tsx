"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { AuthProvider } from "@/components/auth-provider";

// The outer provider tree. The AuthProvider handles BOTH auth backends:
//   - production (NEXT_PUBLIC_AUTH_BACKEND=firebase): Firebase client SDK
//   - local dev (NEXT_PUBLIC_AUTH_BACKEND=nextauth): NextAuth SessionProvider
// See src/components/auth-provider.tsx for the unified `useAuth()` contract.
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );

  return (
    <AuthProvider>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </AuthProvider>
  );
}
