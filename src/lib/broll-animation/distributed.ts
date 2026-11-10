import { createHmac, timingSafeEqual } from "crypto"
import ffmpegPath from "ffmpeg-static"
import { createAdminClient } from "@/lib/supabase/admin"
import { COMPOSITION_SECONDS } from "./compose"
import { RENDER_FPS_BROLL, renderComposition } from "./render"

/**
 * The b-roll render split across several functions at once (Hani,
 * 2026-11-10): on the server one frame takes ~2.6s to screenshot and two
 * pages in one function shared its one CPU, so the 175 frames took ~8.5 of
 * the ~9.5 minutes. Each chunk runs in its OWN function (its own CPU) —
 * api/b-roll/render-chunk — renders a contiguous slice of the frames to an
 * MP4 segment, and the segments are joined without re-encoding. Same 1080×1920
 * frames, same quality; any failure falls back to the one-function render.
 */

const BUCKET = "user-media"
export const RENDER_CHUNKS = 4

/** The key a chunk request carries — derived from a server-only secret. */
export function renderChunkKey(): string {
  return createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").update("broll-render-chunk").digest("hex")
}

export function isRenderChunkKey(key: string | null): boolean {
  if (!key || !process.env.SUPABASE_SERVICE_ROLE_KEY) return false
  const a = Buffer.from(key)
  const b = Buffer.from(renderChunkKey())
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function renderDistributed(
  html: string,
  outputPath: string,
  origin: string,
  timing?: Record<string, number>,
  chunks = RENDER_CHUNKS,
): Promise<void> {
  const started = Date.now()
  const admin = createAdminClient()
  const id = crypto.randomUUID()
  const htmlPath = `_render/${id}.html`
  const segPaths: string[] = []
  const os = await import("os")
  const fs = await import("fs/promises")
  const path = await import("path")
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "broll-dist-"))
  try {
    const { error } = await admin.storage.from(BUCKET).upload(htmlPath, Buffer.from(html), { contentType: "text/html" })
    if (error) throw new Error(`html_upload: ${error.message}`)
    const total = COMPOSITION_SECONDS * RENDER_FPS_BROLL
    const per = Math.ceil(total / chunks)
    const results = await Promise.all(
      Array.from({ length: chunks }, async (_, k) => {
        const from = k * per
        const to = Math.min(total, (k + 1) * per)
        const res = await fetch(new URL("/api/b-roll/render-chunk", origin), {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-render-key": renderChunkKey() },
          body: JSON.stringify({ htmlPath, from, to, segPath: `_render/${id}-${k}.mp4` }),
        })
        const data = (await res.json().catch(() => ({}))) as { path?: string; ms?: number; error?: string }
        if (!res.ok || !data.path) throw new Error(`chunk_${k}: ${data.error ?? res.status}`)
        return data
      }),
    )
    if (timing) {
      timing.renderChunks = chunks
      timing.renderSlowestChunk = Math.max(...results.map((r) => r.ms ?? 0))
    }
    // Download in order and join without re-encoding.
    const list: string[] = []
    for (let k = 0; k < results.length; k++) {
      segPaths.push(results[k].path!)
      const { data, error: dlError } = await admin.storage.from(BUCKET).download(results[k].path!)
      if (dlError || !data) throw new Error(`chunk_${k}_download`)
      const local = path.join(dir, `seg${k}.mp4`)
      await fs.writeFile(local, Buffer.from(await data.arrayBuffer()))
      list.push(`file '${local}'`)
    }
    const listFile = path.join(dir, "list.txt")
    await fs.writeFile(listFile, list.join("\n"))
    const { spawn } = await import("child_process")
    await new Promise<void>((resolve, reject) => {
      const p = spawn(ffmpegPath as unknown as string, ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", "-movflags", "+faststart", outputPath])
      let err = ""
      p.stderr.on("data", (d) => (err = (err + d).slice(-1500)))
      p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`concat: ${err}`))))
    })
    if (timing) timing.renderDistributed = Date.now() - started
  } catch (e) {
    console.error("[broll render] distributed render failed — one-function render instead", e)
    if (timing) {
      timing.renderDistributedFailedAfter = Date.now() - started
      // Why — kept in the composition's timing record, for the next look.
      ;(timing as Record<string, unknown>).renderDistributedError = (e instanceof Error ? e.message : String(e)).slice(0, 300)
    }
    await renderComposition(html, outputPath, timing)
  } finally {
    await admin.storage.from(BUCKET).remove([htmlPath, ...segPaths]).catch(() => undefined)
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}
