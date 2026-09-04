// Server-side authentication helpers.
// NextAuth v4 with Credentials provider. Passwords are bcrypt-hashed.
// Sessions are JWT-based (no Session table needed for the demo).

import type { NextAuthOptions } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { z } from "zod";

const credSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6, "Password must be at least 6 characters"),
  name: z.string().optional(),
  mode: z.enum(["signin", "signup"]).default("signin"),
});

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

        if (mode === "signup") {
          const existing = await db.user.findUnique({ where: { email: emailLc } });
          if (existing) return null; // already exists
          const hash = await bcrypt.hash(password, 12);
          const user = await db.user.create({
            data: { email: emailLc, name: name?.trim() || null, password: hash },
          });
          return { id: user.id, email: user.email, name: user.name } as any;
        }

        // signin
        const user = await db.user.findUnique({ where: { email: emailLc } });
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
