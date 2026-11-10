import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isRenderChunkKey } from "@/lib/broll-animation/distributed"
import { renderComposition } from "@/lib/broll-animation/render"

/**
 * One slice of a distributed b-roll render (lib/broll-animation/distributed).
 * Server-to-server only: the request carries a key derived from a server
 * secret. Renders frames [from, to) of the stored page to an MP4 segment and
 * stores it for the caller to join.
 *
 * POST { htmlPath, from, to, segPath } → { path, ms }
 *
 * Served by FOUR routes (api/b-roll/render-chunk-a…d), each its own function:
 * four requests to one function landed on one instance and shared its CPU —
 * the same render took 1.5 to 4.7 minutes by luck (measured 2026-11-10).
 */

export async function handleRenderChunk(req: NextRequest) {
  if (!isRenderChunkKey(req.headers.get("x-render-key"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const started = Date.now()
  const { htmlPath, from, to, segPath } = (await req.json().catch(() => ({}))) as {
    htmlPath?: string
    from?: number
    to?: number
    segPath?: string
  }
  const ok = (p?: string) => typeof p === "string" && /^_render\/[0-9a-f-]+(-\d+\.mp4|\.html)$/.test(p)
  if (!ok(htmlPath) || !ok(segPath) || typeof from !== "number" || typeof to !== "number" || to <= from) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 })
  }
  const admin = createAdminClient()
  const os = await import("os")
  const fs = await import("fs/promises")
  const path = await import("path")
  const out = path.join(os.tmpdir(), `broll-chunk-${crypto.randomUUID()}.mp4`)
  try {
    const { data, error } = await admin.storage.from("user-media").download(htmlPath!)
    if (error || !data) return NextResponse.json({ error: "html_missing" }, { status: 400 })
    await renderComposition(await data.text(), out, undefined, 1, { from, to })
    const { error: upError } = await admin.storage
      .from("user-media")
      .upload(segPath!, await fs.readFile(out), { contentType: "video/mp4", upsert: true })
    if (upError) return NextResponse.json({ error: upError.message }, { status: 500 })
    return NextResponse.json({ path: segPath, ms: Date.now() - started })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[b-roll/render-chunk]", msg)
    return NextResponse.json({ error: msg.slice(0, 200) }, { status: 500 })
  } finally {
    await fs.unlink(out).catch(() => undefined)
  }
}
