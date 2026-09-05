import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getRepository } from "@/lib/data/repository";

// POST /api/discord — share a dream to a Discord channel via webhook.
//
// Reads the DISCORD_WEBHOOK_URL environment variable. If not set, returns 503
// so the UI can gracefully hide the button.
//
// Body: { dreamId: string }
// Returns 200 on success, 503 if not configured, 404 if dream not found.

export async function POST(req: Request) {
  let userId: string;
  try {
    userId = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    return NextResponse.json(
      { error: "not_configured", message: "Discord sharing is not configured on this server." },
      { status: 503 }
    );
  }

  let body: { dreamId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.dreamId) {
    return NextResponse.json({ error: "missing_dreamId" }, { status: 400 });
  }

  const db = await getRepository();
  const dream = await db.dream.findFirst({
    where: { id: body.dreamId, userId },
    include: { analysis: true },
  });

  if (!dream) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const title = dream.title ?? "Untitled Dream";
  const mood = dream.mood ?? "";
  const summary = dream.analysis?.summary ?? dream.rawText?.slice(0, 300) ?? "";
  const motifList = (dream.analysis?.motifs ?? [])
    .slice(0, 5)
    .map((m: any) => `• ${m.name ?? m}`)
    .join("\n");

  // Discord Embed
  const embed = {
    title: `🌙 ${title}`,
    description: summary.slice(0, 500) + (summary.length > 500 ? "…" : ""),
    color: 0x6d28d9, // violet-700 — matches DreamWeaver brand
    fields: [
      ...(mood ? [{ name: "Mood", value: mood, inline: true }] : []),
      ...(motifList ? [{ name: "Dream Motifs", value: motifList, inline: false }] : []),
    ],
    footer: {
      text: "Shared via DreamWeaver · Powered by Gemini",
    },
    timestamp: new Date().toISOString(),
  };

  const payload = {
    username: "DreamWeaver",
    embeds: [embed],
  };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("[discord] Webhook failed:", res.status, errText);
      return NextResponse.json(
        { error: "webhook_failed", message: "Discord webhook returned an error." },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[discord] Webhook request failed:", e?.message ?? e);
    return NextResponse.json(
      { error: "network_error", message: "Could not reach Discord." },
      { status: 502 }
    );
  }
}

// GET /api/discord — check if Discord sharing is configured
export async function GET() {
  const configured = !!process.env.DISCORD_WEBHOOK_URL;
  return NextResponse.json({ configured });
}
