import { NextRequest } from "next/server"
import { handleTalkingHeadEdit } from "@/lib/talking-head-route"

/**
 * POST { postId, url? } → { url, lines } — "רק כתוביות" (Hani, 2026-11-07):
 * her speech burned as synced captions, from her ORIGINAL video, in her font
 * (else Rubik). See lib/talking-head-edit. Hani + Nataliya only.
 */
export const maxDuration = 800

export async function POST(req: NextRequest) {
  const { postId, url } = (await req.json().catch(() => ({}))) as { postId?: string; url?: string }
  return handleTalkingHeadEdit({ postId, url, captions: true, moments: [] })
}
