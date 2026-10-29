"use client"

import { flushPendingSaves } from "@/lib/pending-saves"
import { getFormatMeta, setFormatMeta } from "@/lib/timing-storage"
import { forgetCarouselSlides } from "@/lib/carousel-caption"
import { isDriveUrl } from "@/lib/drive-media"
import type { CaptionSpec, OwnEditFormat, OwnEditOp, OwnEditPlan, OwnFrameInfo } from "@/lib/own-media"

/**
 * Runs "עריכת מדיה עם AI" on media she brought herself (Hani, 2026-10-29):
 * asks /api/media/own-edit for a plan, then carries it out with the code
 * paths the app already has —
 *   - caption on a video   → /api/story/generate-video-media (the ffmpeg burn)
 *   - caption on a still   → /api/media/caption-image (the satori render)
 *   - a new AI slide       → /api/media/own-edit {action:"slide"}
 *   - remove / reorder / duplicate → just the order of the set
 * and saves the finished set once, at the end.
 *
 * A caption is always drawn over the ORIGINAL (from the render's caption
 * record), never over what's on screen, so it can't stack.
 */

export type OwnEditResult =
  | { ok: true; changed: true; urls: string[]; driveLinks: string[] | null; message: string; styleChange: boolean }
  | { ok: true; changed: false; message: string; refused?: boolean }
  | { ok: false; message: string }

const FAIL = "העריכה לא הצליחה הפעם. נסו שוב."

async function postJson<T>(url: string, body: unknown): Promise<{ ok: boolean; data: T }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as T
  return { ok: res.ok, data }
}

/** Originals this browser remembers for stills captioned before records existed. */
function knownOriginals(postId: string, format: OwnEditFormat, urls: string[]): Record<string, string> {
  if (format !== "image_post" && format !== "b_roll") return {}
  const src = getFormatMeta(postId, format).captionSourceUrl
  return src ? Object.fromEntries(urls.map((u) => [u, src])) : {}
}

export async function runOwnMediaEdit(opts: {
  postId: string
  format: OwnEditFormat
  instruction: string
  /** The set as the card shows it — only used to look up remembered originals. */
  currentUrls: string[]
  currentFrame?: number
  history?: { role: "user" | "assistant"; content: string }[]
  onProgress?: (text: string) => void
}): Promise<OwnEditResult> {
  const { postId, format } = opts
  try {
    // The burn routes read nothing from the script here, but the plan reads
    // the post's words — make sure the DB has what she sees.
    await flushPendingSaves()
    const planned = await postJson<{
      plan?: OwnEditPlan
      frames?: OwnFrameInfo[]
      driveLinks?: string[] | null
      message?: string
      error?: string
    }>("/api/media/own-edit", {
      action: "plan",
      postId,
      format,
      instruction: opts.instruction,
      currentFrame: opts.currentFrame,
      knownOriginals: knownOriginals(postId, format, opts.currentUrls),
      history: opts.history,
    })
    if (!planned.ok || !planned.data.plan || !planned.data.frames) {
      return { ok: false, message: planned.data.message ?? FAIL }
    }
    const { plan, frames, driveLinks } = planned.data
    if (plan.ops.length === 0) {
      return {
        ok: true,
        changed: false,
        refused: plan.refused,
        message: plan.reply || "לא הבנתי מה לשנות. אפשר לנסח שוב?",
      }
    }
    return await execute(postId, format, plan, frames, driveLinks ?? null, opts.onProgress)
  } catch (err) {
    console.error("[own-media-edit]", err)
    return { ok: false, message: FAIL }
  }
}

/** One frame of the working set, carrying what we know about it. */
type Item = OwnFrameInfo & { link?: string }

async function execute(
  postId: string,
  format: OwnEditFormat,
  plan: OwnEditPlan,
  frames: OwnFrameInfo[],
  driveLinks: string[] | null,
  onProgress?: (text: string) => void,
): Promise<OwnEditResult> {
  // Ops address frames by their number in the set she was looking at, so
  // caption ops resolve against `original`; structure ops then rebuild `set`.
  const original: Item[] = frames.map((f, i) => ({ ...f, link: driveLinks?.[i] }))
  const problems: string[] = []
  let styleChange = false

  for (const op of plan.ops) {
    if (op.op !== "set_caption" && op.op !== "remove_caption") continue
    if (op.op === "set_caption" && (op.style || op.position)) styleChange = true
    for (const n of op.frames) {
      const item = original[n - 1]
      if (!item) continue
      onProgress?.(
        op.op === "remove_caption"
          ? `מורידים את הכיתוב (${n} מתוך ${frames.length})...`
          : `מעדכנים את הכיתוב (${n} מתוך ${frames.length})...`,
      )
      const next = op.op === "remove_caption" ? await uncaption(item) : await caption(postId, format, item, op)
      if ("error" in next) problems.push(next.error)
      else original[n - 1] = next.item
    }
  }

  let set: Item[] = [...original]
  for (const op of plan.ops) {
    if (op.op === "reorder") {
      set = op.order.map((n) => original[n - 1]).filter(Boolean)
    } else if (op.op === "remove_slide") {
      const drop = new Set(op.frames.map((n) => original[n - 1]))
      set = set.filter((it) => !drop.has(it))
    } else if (op.op === "duplicate_slide") {
      const it = original[op.frame - 1]
      const at = set.indexOf(it)
      if (at >= 0) set.splice(at + 1, 0, { ...it })
    } else if (op.op === "add_slide") {
      onProgress?.("מעצבים שקופית חדשה בשפה הוויזואלית שלכם... זה לוקח כדקה")
      const made = await postJson<{ url?: string; message?: string }>("/api/media/own-edit", {
        action: "slide",
        postId,
        format,
        headline: op.headline,
        body: op.body,
        role: op.role ?? "closing",
      })
      if (!made.ok || !made.data.url) {
        problems.push(made.data.message ?? "השקופית החדשה לא נוצרה.")
        continue
      }
      const anchor = op.after === 0 ? null : original[op.after - 1]
      const at = anchor ? set.indexOf(anchor) + 1 : 0
      const fresh: Item = { url: made.data.url, kind: "image", aiMade: true, caption: "baked" }
      set.splice(at < 0 ? set.length : at, 0, fresh)
    }
  }

  const urls = set.map((it) => it.url)
  const changed = urls.length !== frames.length || urls.some((u, i) => u !== frames[i].url)
  if (!changed) {
    return problems.length
      ? { ok: false, message: problems[0] }
      : { ok: true, changed: false, message: plan.reply || "לא היה מה לשנות." }
  }
  if (urls.length === 0) return { ok: false, message: "לא אשאיר את הסטורי בלי פריימים. כדי למחוק הכל השתמשו במחיקה." }

  onProgress?.("שומרים...")
  const links = driveLinks ? set.map((it) => it.link ?? "") : null
  const saved = await postJson<{ urls?: string[]; message?: string; error?: string }>("/api/media/own-edit", {
    action: "save",
    postId,
    format,
    urls,
    ...(format === "carousel" && links ? { driveLinks: links } : {}),
  })
  if (!saved.ok) return { ok: false, message: saved.data.message ?? FAIL }

  // Keep the card's caption controls honest about what's on the media now.
  if (format === "carousel") forgetCarouselSlides(postId)
  if (format === "image_post" || format === "b_roll") {
    const it = set[0]
    setFormatMeta(postId, format, {
      captionOn: it.caption === "ours" || it.caption === "baked",
      ...(it.record ? { captionSourceUrl: it.record.sourceUrl, captionPosition: it.record.caption.position ?? "bottom" } : {}),
    })
  }

  const note = problems.length ? ` (${problems[0]})` : ""
  return {
    ok: true,
    changed: true,
    urls,
    driveLinks: format === "carousel" ? links : null,
    message: (plan.reply || "עדכנתי.") + note,
    styleChange,
  }
}

/** Back to the file as she brought it. */
async function uncaption(item: Item): Promise<{ item: Item } | { error: string }> {
  if (item.caption === "ours-legacy") {
    return {
      error:
        "את הכיתוב הזה אי אפשר להוריד: הקובץ המקורי שלכם, בלי הכיתוב, לא נשמר. חברו אותו שוב מהדרייב ומשם אפשר לשנות אותו.",
    }
  }
  if (item.caption === "baked" && !item.aiMade) {
    return { error: "המילים בפריים הזה הן חלק מהקובץ שלכם עצמו, ואותן אני לא משנה." }
  }
  // Nothing of ours on it — nothing to take off.
  if (item.caption !== "ours" || !item.record) return { item }
  const source = await displayable(item.record.sourceUrl, item.kind)
  if (!source) return { error: "לא הצלחתי לטעון את הקובץ המקורי מהדרייב." }
  return { item: { ...item, url: source, caption: "none", record: undefined } }
}

/** Draw the caption over the original, with the plan's changes. */
async function caption(
  postId: string,
  format: OwnEditFormat,
  item: Item,
  op: Extract<OwnEditOp, { op: "set_caption" }>,
): Promise<{ item: Item } | { error: string }> {
  if (item.aiMade) return { error: "את השקופית שה-AI עיצב אפשר לערוך בבקשה נפרדת." }
  if (item.caption === "ours-legacy") {
    return {
      error:
        "את הכיתוב הזה אי אפשר לשנות: הקובץ המקורי שלכם, בלי הכיתוב, לא נשמר. חברו אותו שוב מהדרייב ומשם אפשר לשנות אותו כמה שתרצו.",
    }
  }
  const prev: CaptionSpec = item.record?.caption ?? {}
  const spec: CaptionSpec = {
    headline: op.headline ?? prev.headline,
    body: op.body ?? prev.body,
    position: op.position ?? prev.position ?? "bottom",
    style: op.style ? { ...prev.style, ...op.style } : prev.style,
  }
  if (!spec.headline && !spec.body) {
    return { error: "לא היה כתוב לי מה לשים בכיתוב. כתבו את הנוסח ואעדכן." }
  }
  // Over the original — or, on a bare frame, over the frame itself.
  const rawSource = item.record?.sourceUrl ?? item.url
  const source = await displayable(rawSource, item.kind, true)
  if (!source) return { error: "לא הצלחתי לטעון את הקובץ המקורי." }

  if (item.kind === "video") {
    const r = await postJson<{ url?: string; message?: string; error?: string }>("/api/story/generate-video-media", {
      postId,
      format: format === "b_roll" ? "b_roll" : "story",
      sourceUrl: source,
      persist: false,
      caption: spec,
    })
    if (!r.ok || !r.data.url) return { error: r.data.message ?? r.data.error ?? "הטמעת הכיתוב בסרטון נכשלה." }
    return { item: { ...item, url: r.data.url, caption: "ours", record: { v: 1, sourceUrl: source, caption: spec } } }
  }
  const r = await postJson<{ url?: string; message?: string; error?: string }>("/api/media/caption-image", {
    postId,
    format,
    sourceUrl: source,
    persist: false,
    store: true,
    force: true,
    caption: spec,
  })
  if (!r.ok || !r.data.url) return { error: r.data.message ?? r.data.error ?? "הטמעת הכיתוב בתמונה נכשלה." }
  return { item: { ...item, url: r.data.url, caption: "ours", record: { v: 1, sourceUrl: source, caption: spec } } }
}

/**
 * A URL the card can show. A video stays a Drive link (that's how her clips
 * live); a still on Drive is copied into storage first, like every import.
 * `forRender`: the caption routes fetch Drive themselves, so leave it.
 */
async function displayable(url: string, kind: "image" | "video", forRender = false): Promise<string | null> {
  if (!isDriveUrl(url) || kind === "video" || forRender) return url
  const r = await postJson<{ url?: string }>("/api/media/from-drive", { url, store: true })
  return r.ok && r.data.url ? r.data.url : null
}
