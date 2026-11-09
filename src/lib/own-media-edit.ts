"use client"

import { flushPendingSaves } from "@/lib/pending-saves"
import { getFormatMeta, setFormatMeta } from "@/lib/timing-storage"
import { forgetCarouselSlides } from "@/lib/carousel-caption"
import { isDriveUrl } from "@/lib/drive-media"
import { NO_SCRIPT_TEXT } from "@/lib/script-text"
import type { CaptionSpec, OwnEditFormat, OwnEditOp, OwnEditPlan, OwnFrameInfo } from "@/lib/own-media"

/**
 * Runs "עריכת מדיה עם AI" on media she brought herself (Hani, 2026-10-29):
 * asks /api/media/own-edit for a plan, then carries it out with the code
 * paths the app already has —
 *   - caption on a video   → /api/story/generate-video-media (the ffmpeg burn)
 *   - caption on a still   → /api/media/caption-image (the satori render)
 *   - a new AI slide       → /api/media/own-edit {action:"slide"}
 *   - a new animated frame → /api/media/own-edit {action:"animated_slide"}
 *                            (story; the b-roll engine, ~3 min)
 *   - change an animated frame the AI made → {action:"edit_animated_frame"}
 *                            (its stored composition revised, re-rendered,
 *                            replaced in place; never one of her own frames)
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

/** The busy row while the animated frame renders (it's the long one). */
export const ANIMATING = "מנפישים פריים חדש עם הטקסט שלכם... זה לוקח כשלוש דקות"

/** The busy row while an animated frame the AI made is re-rendered with her change. */
export function reanimating(frame: number): string {
  return `מעדכנים את פריים ${frame} לפי מה שביקשתם... זה לוקח כשתי דקות`
}

/** Said once when an older animated frame had nothing to edit and was made again. */
export const REMADE_NOTE = "הפריים הזה נוצר לפני שהתחלנו לשמור את העיצוב שלו, אז יצרתי אותו מחדש לפי מה שביקשתם."

/** A clip the animation engine made (lib/own-media-animated), not one of hers. */
const AI_ANIM_CLIP = /\/story\/ai-anim-[0-9a-f-]{36}\.mp4/i

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
  /** Her attached file was just imported as this media, for this request. */
  justImported?: boolean
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
      /** The fixed story text paths (gated, story only). */
      ownStoryText?: boolean
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
      justImported: opts.justImported,
    })
    if (!planned.ok || !planned.data.plan || !planned.data.frames) {
      return { ok: false, message: planned.data.message ?? FAIL }
    }
    const { plan, frames, driveLinks } = planned.data
    const ownStory = format === "story" && planned.data.ownStoryText === true
    // Her files just became the story (gated): the script's text goes on
    // them, no questions — even when the planner came back with nothing.
    if (ownStory && opts.justImported && plan.ops.length === 0 && !plan.refused && plan.script?.length) {
      const script = plan.script
      plan.ops = frames.flatMap((_, i) =>
        // A frame past the script: an empty op, which execute turns into the NO_SCRIPT_TEXT note.
        script[i]
          ? [{ op: "set_caption" as const, frames: [i + 1], headline: script[i].headline ?? "", body: script[i].body ?? "" }]
          : [{ op: "set_caption" as const, frames: [i + 1] }],
      )
    }
    if (plan.ops.length === 0) {
      return {
        ok: true,
        changed: false,
        refused: plan.refused,
        message: plan.reply || "לא הבנתי מה לשנות. אפשר לנסח שוב?",
      }
    }
    return await execute(postId, format, plan, frames, driveLinks ?? null, opts.onProgress, opts.instruction, ownStory)
  } catch (err) {
    console.error("[own-media-edit]", err)
    return { ok: false, message: FAIL }
  }
}

/** One frame of the working set, carrying what we know about it. */
type Item = OwnFrameInfo & { link?: string; /** Made by duplicate_slide from this frame. */ copyOf?: OwnFrameInfo }

async function execute(
  postId: string,
  format: OwnEditFormat,
  plan: OwnEditPlan,
  frames: OwnFrameInfo[],
  driveLinks: string[] | null,
  onProgress?: (text: string) => void,
  /** Her words this turn — the animated caption on a video follows them. */
  instruction?: string,
  /** The fixed story text paths (gated, story only). */
  ownStory = false,
): Promise<OwnEditResult> {
  // Ops address frames by their number in the set she was looking at, so
  // caption ops resolve against `original`; structure ops then rebuild `set`.
  const original: Item[] = frames.map((f, i) => ({ ...f, link: driveLinks?.[i] }))
  const problems: string[] = []
  const notes: string[] = []
  let styleChange = false

  // An animated frame the AI made, changed in place — before the structure
  // ops, so a reorder or a new slide still finds it at its number.
  for (const op of plan.ops) {
    if (op.op !== "edit_animated_frame") continue
    const item = original[op.frame - 1]
    if (!item) continue
    if (!item.aiMade || item.kind !== "video" || !AI_ANIM_CLIP.test(item.url)) {
      problems.push(
        item.aiMade
          ? "את השקופית הזאת אפשר לעצב מחדש כשקופית חדשה במקומה. בקשו ואחליף אותה."
          : "את הפריים הזה צילמתם בעצמכם, ואותו אני לא משנה.",
      )
      continue
    }
    onProgress?.(reanimating(op.frame))
    const made = await postJson<{ url?: string; remade?: boolean; message?: string }>("/api/media/own-edit", {
      action: "edit_animated_frame",
      postId,
      format,
      url: item.url,
      instruction: op.instruction,
      design: op.design,
      headline: op.headline,
      body: op.body,
      newBackground: op.newBackground,
      role: op.frame === 1 ? "cover" : op.frame === frames.length ? "closing" : "content",
    })
    if (!made.ok || !made.data.url) {
      problems.push(made.data.message ?? "העדכון של הפריים המונפש לא הצליח.")
      continue
    }
    if (made.data.remade && !notes.includes(REMADE_NOTE)) notes.push(REMADE_NOTE)
    styleChange = true
    original[op.frame - 1] = { ...item, url: made.data.url }
  }

  // Every frame's caption renders at the same time (Hani, 2026-11-09: three
  // animated captions one after another took ~12 minutes; side by side ~4).
  // Ops on the same frame still run in order, one after the other.
  const captionOps = plan.ops.filter(
    (op): op is Extract<OwnEditOp, { op: "set_caption" | "remove_caption" }> =>
      op.op === "set_caption" || op.op === "remove_caption",
  )
  if (captionOps.some((op) => op.op === "set_caption" && (op.style || op.position))) styleChange = true
  const byFrame = new Map<number, typeof captionOps>()
  for (const op of captionOps) for (const n of op.frames) byFrame.set(n, [...(byFrame.get(n) ?? []), op])
  if (byFrame.size) {
    const removing = captionOps.every((op) => op.op === "remove_caption")
    onProgress?.(
      removing
        ? `מורידים את הכיתוב (${byFrame.size} ${byFrame.size === 1 ? "פריים" : "פריימים"} במקביל)...`
        : `מעדכנים את הכיתוב (${byFrame.size} ${byFrame.size === 1 ? "פריים" : "פריימים"} במקביל)...`,
    )
  }
  await Promise.all(
    [...byFrame].map(async ([n, ops]) => {
      for (const op of ops) {
        const item = original[n - 1]
        if (!item) {
          problems.push(`אין פריים ${n} בסט הזה.`)
          return
        }
        // Gated story: a frame the script has no story for gets no text —
        // said plainly, not reported as a failed edit.
        if (
          ownStory &&
          op.op === "set_caption" &&
          !plan.script?.[n - 1] &&
          !op.headline &&
          !op.body &&
          !item.record?.caption.headline &&
          !item.record?.caption.body
        ) {
          if (!notes.includes(NO_SCRIPT_TEXT)) notes.push(NO_SCRIPT_TEXT)
          continue
        }
        const next =
          op.op === "remove_caption" ? await uncaption(item) : await caption(postId, format, item, op, instruction)
        if ("error" in next) problems.push(next.error)
        else original[n - 1] = next.item
      }
    }),
  )

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
      if (at >= 0) set.splice(at + 1, 0, { ...it, copyOf: it })
    } else if (op.op === "add_slide" || op.op === "add_animated_slide") {
      const animated = op.op === "add_animated_slide"
      onProgress?.(
        animated
          ? ANIMATING
          : "מעצבים שקופית חדשה בשפה הוויזואלית שלכם... זה לוקח כדקה",
      )
      const made = await postJson<{ url?: string; message?: string }>("/api/media/own-edit", {
        action: animated ? "animated_slide" : "slide",
        postId,
        format,
        headline: op.headline,
        body: op.body,
        role: op.role ?? "closing",
        design: op.design,
      })
      if (!made.ok || !made.data.url) {
        problems.push(made.data.message ?? (animated ? "הפריים המונפש לא נוצר." : "השקופית החדשה לא נוצרה."))
        continue
      }
      const anchor = op.after === 0 ? null : original[op.after - 1]
      const at = anchor ? set.indexOf(anchor) + 1 : 0
      const fresh: Item = { url: made.data.url, kind: animated ? "video" : "image", aiMade: true, caption: "baked" }
      set.splice(at < 0 ? set.length : at, 0, fresh)
    }
  }

  // A story always has the script's number of stories (Hani, 2026-11-09:
  // "if there are three stories, duplicate it to three, no matter what"):
  // fewer frames than stories → her last frame again for each missing one.
  if (format === "story" && plan.script && set.length > 0 && set.length < plan.script.length) {
    const last = set[set.length - 1]
    const source = last.copyOf ?? last
    while (set.length < plan.script.length) set.push({ ...last, copyOf: source })
  }

  // A copy of a captioned frame carries ITS OWN script text (frame k = the
  // script's unit k), burned over the same original — never the caption of
  // the frame it was copied from.
  if (plan.script?.length) {
    const script = plan.script
    // A copy of a frame that carries its own words (baked in) stays as is.
    const todo = set.flatMap((it, i) =>
      it.copyOf &&
      script[i] &&
      (it.caption === "ours" ||
        it.caption === "none" ||
        // Gated story: a copy of her clip (always "unknown") or of a frame
        // whose own caption failed must still get its story's text, not stay bare.
        (ownStory && it.caption === "unknown" && !it.aiMade))
        ? [i]
        : [],
    )
    if (todo.length) onProgress?.(`מעדכנים את הכיתוב (${todo.length} ${todo.length === 1 ? "פריים" : "פריימים"} במקביל)...`)
    await Promise.all(
      todo.map(async (i) => {
        const it = set[i]
        const unit = script[i]
        const next = await caption(postId, format, it, { op: "set_caption", frames: [i + 1], headline: unit.headline ?? "", body: unit.body ?? "" }, instruction)
        if ("error" in next) problems.push(next.error)
        else set[i] = { ...next.item, link: it.link }
      }),
    )
  }

  const urls = set.map((it) => it.url)
  const changed = urls.length !== frames.length || urls.some((u, i) => u !== frames[i].url)
  if (!changed) {
    return problems.length
      ? { ok: false, message: problems[0] }
      : { ok: true, changed: false, message: (ownStory && notes.length ? notes.join(" ") : plan.reply) || "לא היה מה לשנות." }
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

  // The plan's reply is written BEFORE anything ran and says everything was
  // done. When a step failed it would claim what didn't happen (Hani,
  // 2026-11-09: "it says it did something, but it didn't") — say plainly
  // what didn't work instead.
  const failed = [...new Set(problems)]
  const said = failed.length
    ? `עשיתי רק חלק ממה שביקשתם. מה שלא הצליח: ${failed.join(" ")}`
    : plan.reply || "עדכנתי."
  const note = notes.length ? ` ${notes.join(" ")}` : ""
  return {
    ok: true,
    changed: true,
    urls,
    driveLinks: format === "carousel" ? links : null,
    message: said + note,
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
  /** Her words this turn — how the animated caption on a video should look and move. */
  instruction?: string,
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
    // Her words build up over the edits: later ones win where they clash.
    design: [prev.design, item.kind === "video" ? instruction?.trim() : undefined].filter(Boolean).join("\n") || undefined,
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
      // Animated, in her visual language — like the AI b-roll (Hani, 2026-11-06).
      animated: true,
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
