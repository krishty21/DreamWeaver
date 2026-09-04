import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getRepository } from "@/lib/data/repository";

// Returns the current authenticated user's public profile + counts.
export async function GET() {
  let userId: string;
  try {
    userId = await requireUser();
  } catch {
    return NextResponse.json({ user: null }, { status: 200 });
  }

  const db = await getRepository();
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, createdAt: true },
  });
  if (!user) return NextResponse.json({ user: null }, { status: 200 });

  const [dreamCount, sessionCount] = await Promise.all([
    db.dream.count({ where: { userId } }),
    db.arcadeSession.count({ where: { userId } }),
  ]);

  return NextResponse.json({
    user: { ...user, dreamCount, sessionCount },
  });
}
