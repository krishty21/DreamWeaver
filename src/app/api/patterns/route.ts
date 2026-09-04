import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { computePatternReport } from "@/lib/patterns";

// GET — longitudinal pattern report, computed app-side (authoritative).
export async function GET() {
  let userId: string;
  try {
    userId = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const report = await computePatternReport(userId);
  return NextResponse.json({ report });
}
