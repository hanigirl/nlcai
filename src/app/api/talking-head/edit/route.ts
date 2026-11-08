import { NextRequest } from "next/server"
import { handleTalkingHeadEdit, parseMoments } from "@/lib/talking-head-route"

/**
 * POST { postId, url?, moments, captions?, request? } → { url, lines }
 * The edit after "אישור" on the plan (Hani, 2026-11-07): each approved moment
 * as its element (card / highlight / animation, designed on Opus 5.5 in her
 * visual language), plus her synced captions when the plan has them — from
 * her ORIGINAL video. See lib/talking-head-edit. Hani + Nataliya only.
 */
export const maxDuration = 800

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    postId?: string
    url?: string
    moments?: unknown
    captions?: unknown
    cuts?: unknown
    request?: string
  }
  return handleTalkingHeadEdit({
    postId: body.postId,
    url: body.url,
    captions: body.captions !== false,
    moments: parseMoments(body.moments),
    // Fillers and dead air out first — the plan says so; only when needed.
    cuts: body.cuts === true,
    request: typeof body.request === "string" ? body.request.slice(0, 1000) : undefined,
  })
}
