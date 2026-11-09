import { scriptBlocks, storyFrames, stripFrameMarkers } from "@/lib/story-text-split"
import { parseTextToSlides } from "@/lib/carousel-slides"
import { parseImagePostBody } from "@/lib/image-post-text"
import Anthropic from "@anthropic-ai/sdk"
import {
  canAddAnimatedFrame,
  cleanCaptionStyle,
  isSetFormat,
  type OwnEditFormat,
  type OwnEditOp,
  type OwnEditPlan,
  type OwnFrameInfo,
} from "@/lib/own-media"
import { KEEP_INSIDE_FRAME_RULE } from "@/lib/openai-image"
import { noExtrasRule, type DesignDirection } from "@/lib/visual-language/direction"
import { reservedZoneLines, type ImageRole } from "@/lib/visual-language/fixed-elements"

/**
 * The planner behind "עריכת מדיה עם AI" on media she brought herself
 * (Hani, 2026-10-29). Opus reads her request against the frames and answers
 * with a short list of operations from a closed set — caption, slides
 * (still, or with animated text on a story), order. It never gets an
 * operation that repaints her pixels, so a request for one can only come back
 * as a kind refusal — one that offers what it can do instead, never "can't
 * animate".
 *
 * Frames the AI made are the opposite: new pixels of ours, so their look is
 * fully in our hands (Hani, 2026-10-29: "למה הוא יכול כשאני איתו בקלוד אבל
 * פה לא?"). Her design wording travels to the engine as `design`, and an
 * animated frame is changed in place (edit_animated_frame), never re-rolled.
 */

const NOUN: Record<OwnEditFormat, { item: string; set: string }> = {
  story: { item: "frame", set: "Instagram story" },
  carousel: { item: "slide", set: "Instagram carousel" },
  image_post: { item: "image", set: "single Instagram feed image" },
  b_roll: { item: "clip", set: "b-roll reel (one clip or still)" },
}

function describeFrame(f: OwnFrameInfo, i: number): string {
  const who = f.aiMade
    ? f.kind === "video"
      ? "AI-MADE frame with animated text (we made it earlier, a video clip) — fully ours: its background, colours, text, size and motion can all be changed with edit_animated_frame"
      : "AI-MADE still slide (we made it earlier) — fully ours: to change its look, replace it (remove_slide + add_slide at the same spot, with her design wording)"
    : `HER OWN ${f.kind === "video" ? "video" : "photo/image"}`
  const cap =
    f.caption === "ours"
      ? `has our caption: ${JSON.stringify({
          headline: f.record?.caption.headline ?? null,
          body: f.record?.caption.body ?? null,
          position: f.record?.caption.position ?? "bottom",
          style: f.record?.caption.style ?? null,
        })} (can be rewritten, restyled, moved or removed)`
      : f.caption === "ours-legacy"
        ? "has our caption from an older render; the original under it was NOT kept, so that caption can't be rewritten, moved or removed (only a new slide/order change is possible for it)"
        : f.caption === "baked"
          ? "her own design already has its words in it — never add a caption here unless she explicitly asks to add text to this very frame"
          : f.caption === "none"
            ? "bare, no words on it"
            : "unknown whether it already has words in it (treat like 'already has words': only add a caption if she explicitly asks for text on it)"
  return `${i + 1}. ${who}; ${cap}`
}

export async function planOwnMediaEdit(
  apiKey: string,
  input: {
    format: OwnEditFormat
    instruction: string
    frames: OwnFrameInfo[]
    /** 1-based, the frame on screen when she asked. */
    currentFrame?: number
    post: { title: string | null; hook: string | null; body: string | null; formatBody: string | null }
    history?: { role: "user" | "assistant"; content: string }[]
  },
): Promise<OwnEditPlan> {
  const { format, frames } = input
  const n = frames.length
  // MEDIA TEXT IS THE SCRIPT (Hani, 2026-11-09): every word on her media
  // comes from the format's script, split the way the card splits it — a
  // story's stories, a carousel's slides, an image post's / b-roll's lines.
  // Talking in everyday words is for the script editor, never for the media.
  const units = scriptUnits(format, input.post.formatBody)
  const unitName = format === "story" ? "story" : format === "carousel" ? "slide" : "text"
  const isSet = isSetFormat(format)
  const animated = canAddAnimatedFrame(format)
  const client = new Anthropic({ apiKey })
  const ops = [
    `{"op":"set_caption","frames":[1..${n}],"headline"?:string,"body"?:string,"position"?:"top"|"center"|"bottom","style"?:{"pill"?:"#hex"|"none","text"?:"#hex","scale"?:0.6-1.5}} — add, restyle or move the caption. Omitted fields keep the frame's current caption values; to change only the position or look, send only those. The words come from the script, exactly as written — see the hard rule.`,
    `{"op":"remove_caption","frames":[...]} — take our caption off (back to her file as she brought it).`,
    ...(isSet
      ? [
          `{"op":"add_slide","after":0..${n},"headline"?:string,"body"?:string,"role"?:"closing"|"content"|"cover","design"?:string} — a NEW STILL ${NOUN[format].item} (one image) designed by AI in her visual language, inserted after that position (0 = first). Its text is the script's ${NOUN[format].item} for that position, exactly as written (or her own dictated words); with no script text for it, it carries no text. design = ${DESIGN_FIELD}`,
          ...(animated
            ? [
                `{"op":"add_animated_slide","after":0..${n},"headline":string,"body"?:string,"role"?:"closing"|"content"|"cover","design"?:string} — a NEW ${NOUN[format].item} with ANIMATED text: a 7-second vertical video clip, the same motion-design engine as our b-roll (her fonts, brand colours and visual language, kinetic Hebrew type over an AI background). Use it whenever she asks for animation / motion / moving or animated text / "מונפש" / "אנימציה" / "שזז" / "וידאו" for a new frame. headline/body = the script's story for that position, exactly as written (or her own dictated words). design = ${DESIGN_FIELD} Takes ~3 minutes.`,
                `{"op":"edit_animated_frame","frame":k,"instruction":string,"design"?:string,"headline"?:string,"body"?:string,"newBackground"?:boolean} — CHANGE an AI-made animated frame IN PLACE (only a frame marked AI-MADE with animated text; never her own). Applies her request to that frame's motion design and re-renders it: background colour / plain / none, text colour, size, motion style, calmer or bolder, its words. instruction = her request about this frame, in her own words (Hebrew, copied as she said it). design = ${DESIGN_FIELD} headline/body = the frame's NEW words, only when she changes the words (send every line that should be on it); omit both to keep its words. newBackground:true only when she wants a different background PICTURE (another image); a plain / solid / no background, or removing a loud one, needs no new picture. Takes ~2 minutes. Use this — never add_animated_slide — when she asks to change a frame we already animated.`,
              ]
            : []),
          `{"op":"remove_slide","frames":[...]}`,
          `{"op":"duplicate_slide","frame":k}`,
          `{"op":"reorder","order":[the full new order, a permutation of 1..${n}]}`,
        ]
      : []),
  ]
  const system = [
    "You plan edits on social media that a Hebrew-speaking creator FILMED OR PHOTOGRAPHED HERSELF. The rule: you may add on top of her media or take away from it — the caption over it, extra AI-made slides, the order — but you NEVER change, regenerate, repaint, retouch, recolour, crop, filter or 'fix' her own photo or video pixels.",
    `If she asks for something that would change HER OWN pixels — a frame marked HER OWN, never one marked AI-MADE — (brighter, remove an object, change the background, make her look different, improve the photo…), do NOT plan it: return no ops, refused:true, and a kind one-line Hebrew reply saying you can't change what she filmed/photographed, plus what you CAN do instead (the caption over it${isSet ? `, or a NEW frame${animated ? " — still or with animated text" : ""}` : ""}).`,
    ...(isSet
      ? [`Adding NEW frames is always allowed${animated ? " — still or animated —" : ""} because they are new pixels, not hers.`]
      : []),
    "NEVER say animation is impossible or that you can't make animated text: it exists (as a new animated story frame).",
    animated
      ? "A request for animation / motion / animated text on a NEW frame → add_animated_slide. A request for a plain new frame (no motion asked) → add_slide. If she asks to animate or move HER OWN frame, don't plan that, but offer in the reply to add a new animated frame next to it."
      : isSet
        ? "Animated frames exist only in a story here (a carousel item can't be a vertical video). If she asks for animation in this carousel, return no ops and a reply that offers a still slide instead and says an animated frame can be added in the story."
        : "This format is one piece of media, so no frames can be added here. If she asks for animation, return no ops and a reply that says an animated frame can be added in the story.",
    "Frames marked AI-MADE are pixels WE made, not hers: you have FULL control over their look — background (colour, plain, none, a different picture), text colour, size, motion, how plain or bombastic. NEVER say you have no control over background, text colour or style of a frame you made, and never hedge (no \"if it still comes out…\", no \"I can't guarantee\"). Pass her design wording through as `design` — the engine treats it as a hard rule.",
    ...(animated
      ? ["To change an AI-made animated frame → edit_animated_frame on that frame (it is replaced in place). Never add a second animated frame for it, and never remove it to make a new one."]
      : []),
    "If her request is unclear, return no ops and a short Hebrew question in reply.",
    "Reply with JSON only: {\"reply\": \"one short Hebrew line, plural addressing (אתם), saying what you did / why not\", \"ops\": [...], \"refused\"?: true}.",
    "When you plan ops, the reply states what you changed, in her own words, short and sure (e.g. \"בפריים 3 הורדתי את הרקע הלבן הבומבסטי, והטקסט עכשיו לבן ופשוט.\") — no disclaimers, no promises to retry.",
    "Never stack a second caption over words that are already there: a frame marked as already having its own words gets no caption unless she explicitly asks to put text on it.",
    "HARD RULE — THE SCRIPT IS THE TEXT. Every word that goes ON the media (captions, headlines, new frames' text) is copied from the script below, word for word. Never reword, shorten, summarise, translate or 'improve' it, and never invent a title, headline, hook or CTA that isn't in it. Writing in everyday words is the script editor's job, not yours. The only other words allowed are ones she dictates in her request, copied exactly.",
    ...(units.length > 1
      ? [
          `The set follows the script: ${units.length} ${NOUN[format].item}s, in its order — ${NOUN[format].item} k carries script ${unitName} k. Her ${NOUN[format].item}s take the first ones; when she has fewer than the script, add the missing ones as NEW ${NOUN[format].item}s after her last one${animated ? " (add_animated_slide when her media is video or she asked for motion, else add_slide)" : ""}, each with its exact script text. Never fold several into one ${NOUN[format].item}, and never add one the script doesn't have unless she dictates its words.`,
        ]
      : []),
    "Only touch the frames she means: a named one (\"פריים 2\", \"האחרון\", \"השקופית הזאת\" = the one on screen), otherwise all frames her request is about.",
  ].join("\n")
  const user = [
    `Format: ${NOUN[format].set}, ${n} ${NOUN[format].item}${n === 1 ? "" : "s"} numbered 1..${n}${input.currentFrame ? `; ${NOUN[format].item} ${input.currentFrame} is on screen` : ""}.`,
    "Frames:",
    ...frames.map(describeFrame),
    "",
    "The post (Hebrew), for wording:",
    JSON.stringify({
      title: input.post.title,
      hook: input.post.hook,
      // Frame marks ("סטורי 1") are the card's, never caption text.
      formatText: input.post.formatBody ? stripFrameMarkers(input.post.formatBody).slice(0, 1500) : null,
      coreText: input.post.formatBody ? undefined : input.post.body?.slice(0, 1500),
    }),
    ...(units.length
      ? ["", `The script, per ${NOUN[format].item} (exact text to put on the media, in order):`, ...units.map((u, i) => `${i + 1}. ${JSON.stringify(u)}`)]
      : []),
    "",
    "Allowed ops:",
    ...ops.map((o) => `- ${o}`),
    ...(input.history?.length
      ? ["", "Earlier in this conversation:", ...input.history.slice(-6).map((m) => `${m.role === "user" ? "Her" : "You"}: ${m.content}`)]
      : []),
    "",
    `Her request (Hebrew): ${JSON.stringify(input.instruction)}`,
  ].join("\n")

  const msg = await client.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 1500,
    system,
    messages: [{ role: "user", content: user }],
  })
  const text = msg.content.map((c) => (c.type === "text" ? c.text : "")).join("")
  const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as {
    reply?: unknown
    ops?: unknown
    refused?: unknown
  }
  const sane = sanitiseOps(json.ops, n, isSet, animated)
  return {
    reply: typeof json.reply === "string" && json.reply.trim() ? json.reply.trim() : "",
    ops: holdToScript(sane, units, input.instruction),
    refused: json.refused === true || undefined,
  }
}

export type ScriptUnit = { headline?: string; body?: string }

/**
 * The script as the media's text, one unit per frame / slide — split exactly
 * the way the card shows it: a story's stories (story 1 leads with its first
 * block as the headline), a carousel's slides, an image post's labelled
 * lines, a b-roll's hook + reading caption.
 */
export function scriptUnits(format: OwnEditFormat, body: string | null | undefined): ScriptUnit[] {
  if (!body?.trim()) return []
  const clean = (u: ScriptUnit): ScriptUnit | null => {
    const headline = u.headline?.trim() || undefined
    const text = u.body?.trim() || undefined
    return headline || text ? { headline, body: text } : null
  }
  const keep = (list: (ScriptUnit | null)[]) => list.filter((u): u is ScriptUnit => !!u)
  switch (format) {
    case "story":
      return keep(
        storyFrames(body).map((text, k) => {
          if (k > 0) return clean({ body: text })
          const [headline, ...rest] = scriptBlocks(text)
          return clean({ headline, body: rest.join("\n\n") })
        }),
      )
    case "carousel":
      return keep(parseTextToSlides(stripFrameMarkers(body)).map((sl) => clean({ headline: sl.title, body: sl.body })))
    case "image_post": {
      const t = parseImagePostBody(body)
      return t ? keep([clean({ headline: t.headline, body: [t.subheadline, t.bottom].filter(Boolean).join("\n") })]) : []
    }
    default: {
      // b-roll (one piece): the hook line, then the reading caption.
      const lines = stripFrameMarkers(body).split("\n").map((l) => l.trim()).filter(Boolean)
      return lines.length ? keep([clean({ headline: lines[0], body: lines.slice(1).join(" ") })]) : []
    }
  }
}

const squash = (t: string) => t.replace(/[\s"'״׳.,!?:;—–-]+/g, "")

/**
 * The hard rule, in code (Hani, 2026-11-09: "it is reinventing the title,
 * which is a big no-no"): whatever the model wrote, the words on her media
 * are the script's — unless they're hers, dictated in this request. A caption
 * over several frames becomes one per frame, each with its own unit. A new
 * frame the script has no text for gets no text; a planned new frame with
 * made-up words is dropped.
 */
export function holdToScript(ops: OwnEditOp[], units: ScriptUnit[], instruction: string): OwnEditOp[] {
  const said = squash(instruction)
  const dictated = (h?: string, b?: string) => {
    const t = squash([h, b].filter(Boolean).join(""))
    return !!t && said.includes(t)
  }
  const unitAt = (k: number): ScriptUnit | null => units[k] ?? null
  const out: OwnEditOp[] = []
  const added: number[] = []
  for (const op of ops) {
    if (op.op === "set_caption") {
      const wordsChanged = op.headline !== undefined || op.body !== undefined
      if (!wordsChanged || dictated(op.headline, op.body)) {
        out.push(op)
        continue
      }
      for (const f of op.frames) {
        const u = unitAt(f - 1)
        // No script text for this frame: keep its current words (look/position only).
        out.push(u ? { ...op, frames: [f], headline: u.headline, body: u.body } : { ...op, frames: [f], headline: undefined, body: undefined })
      }
      continue
    }
    if (op.op === "add_slide" || op.op === "add_animated_slide") {
      // Where it lands: after `after`, past the new frames already put there.
      const at = op.after + added.filter((a) => a <= op.after).length
      if (dictated(op.headline, op.body)) {
        added.push(op.after)
        out.push(op)
        continue
      }
      const u = unitAt(at)
      if (u) {
        added.push(op.after)
        // An animated frame needs a main line: a body-only unit leads with its text.
        out.push(
          op.op === "add_animated_slide" && !u.headline
            ? { ...op, headline: u.body, body: undefined }
            : { ...op, headline: u.headline, body: u.body },
        )
      } else if (op.op === "add_slide" && !op.headline && !op.body) {
        // A picture-only slide she asked for: no words to hold.
        added.push(op.after)
        out.push(op)
      }
      // Beyond the script with the model's own words: dropped, never shown.
      continue
    }
    if (op.op === "edit_animated_frame" && (op.headline !== undefined || op.body !== undefined) && !dictated(op.headline, op.body)) {
      const u = unitAt(op.frame - 1)
      out.push(
        u
          ? { ...op, headline: u.headline ?? u.body, body: u.headline ? u.body : undefined }
          : { ...op, headline: undefined, body: undefined },
      )
      continue
    }
    out.push(op)
  }
  return out
}

/** The `design` field, explained to the planner (one place for every op that has it). */
const DESIGN_FIELD =
  "her own wording about the LOOK (background, colours, text size, motion, plain vs. bombastic), copied in her words, Hebrew is fine; omit when she said nothing about the look. It is a hard instruction that wins over the visual-language defaults."

const inRange = (v: unknown, n: number) => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= n

function frameList(v: unknown, n: number): number[] {
  const list = Array.isArray(v) ? v.filter((x) => inRange(x, n)) : []
  return Array.from(new Set(list as number[]))
}

/** Drop anything outside the closed set or pointing at frames that don't exist. */
export function sanitiseOps(raw: unknown, n: number, isSet: boolean, animated = false): OwnEditOp[] {
  if (!Array.isArray(raw)) return []
  const out: OwnEditOp[] = []
  for (const r of raw) {
    if (!r || typeof r !== "object") continue
    const o = r as Record<string, unknown>
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined)
    switch (o.op) {
      case "set_caption": {
        const frames = frameList(o.frames, n)
        if (!frames.length) break
        const position =
          o.position === "top" || o.position === "center" || o.position === "bottom" ? o.position : undefined
        out.push({ op: "set_caption", frames, headline: str(o.headline), body: str(o.body), position, style: cleanCaptionStyle(o.style) })
        break
      }
      case "remove_caption": {
        const frames = frameList(o.frames, n)
        if (frames.length) out.push({ op: "remove_caption", frames })
        break
      }
      case "add_slide":
      case "add_animated_slide": {
        if (!isSet) break
        const after = typeof o.after === "number" ? Math.min(n, Math.max(0, Math.round(o.after))) : n
        const role = o.role === "closing" || o.role === "content" || o.role === "cover" ? o.role : undefined
        // Never quietly swap an animated ask for a still one where it can't be.
        if (o.op === "add_animated_slide" && !animated) break
        out.push({ op: o.op, after, headline: str(o.headline), body: str(o.body), role, design: str(o.design) })
        break
      }
      case "edit_animated_frame": {
        // Which frames are AI-made is checked when it runs (lib/own-media-edit)
        // and again by the route; here only the shape.
        if (!animated || !inRange(o.frame, n)) break
        const instruction = str(o.instruction) ?? str(o.design)
        if (!instruction) break
        out.push({
          op: "edit_animated_frame",
          frame: o.frame as number,
          instruction,
          design: str(o.design),
          headline: str(o.headline),
          body: str(o.body),
          newBackground: o.newBackground === true || undefined,
        })
        break
      }
      case "remove_slide": {
        if (!isSet) break
        const frames = frameList(o.frames, n)
        if (frames.length) out.push({ op: "remove_slide", frames })
        break
      }
      case "duplicate_slide": {
        if (isSet && inRange(o.frame, n)) out.push({ op: "duplicate_slide", frame: o.frame as number })
        break
      }
      case "reorder": {
        if (!isSet || !Array.isArray(o.order)) break
        const order = o.order as unknown[]
        const ok = order.length === n && new Set(order).size === n && order.every((x) => inRange(x, n))
        if (ok) out.push({ op: "reorder", order: order as number[] })
        break
      }
    }
  }
  return out
}

/* ---------------------------- the new slide ----------------------------- */

export function slidePrompt(input: {
  format: "story" | "carousel"
  headline?: string
  body?: string
  role: ImageRole
  direction: DesignDirection
  context: string
  width: number
  height: number
  /** Her own words about the look — wins over the visual language. */
  design?: string
}): string {
  const text = [input.headline, input.body].filter(Boolean).join("\n")
  const story = input.format === "story"
  return [
    story
      ? "Design a complete, polished vertical Instagram STORY frame (9:16, full-bleed) in HEBREW."
      : "Design a complete, polished Instagram CAROUSEL slide (4:5 portrait, full-bleed) in HEBREW.",
    "It joins a set the creator filmed / photographed herself, so it must feel like part of her brand — not a stock template.",
    "",
    text
      ? `The ${story ? "frame" : "slide"} contains exactly this Hebrew text, spelled EXACTLY as written, right-to-left (RTL), and no other words:\n"""${text}"""`
      : "No text on this one — imagery only.",
    "",
    input.role === "closing"
      ? "This is the closing one — it lands the message and the call-to-action, warm and decisive."
      : input.role === "cover"
        ? "This is the opening one — the headline dominates, pulling the viewer in."
        : "It carries the message forward.",
    "",
    "Design:",
    ...input.direction.lines,
    ...(input.design
      ? [
          "",
          "THE CREATOR'S OWN DESIGN INSTRUCTION (hard rule — it wins over the design lines above: background, text colour, size, plain vs. bombastic):",
          `"""${input.design}"""`,
        ]
      : []),
    "",
    "Rules that always hold:",
    "- Correct Hebrew letterforms and right-to-left reading order; reproduce every character precisely.",
    "- High legibility: strong contrast between text and background.",
    ...(story
      ? ["- INSTAGRAM STORY SAFE ZONE: keep ALL text and key elements within the central 62% of the height — the TOP ~14% and BOTTOM ~24% stay free of text."]
      : []),
    KEEP_INSIDE_FRAME_RULE,
    ...reservedZoneLines(input.direction.fixed, input.role, input.width, input.height),
    `- The mood relates to this post (Hebrew): """${input.context}"""`,
    "",
    `Do NOT add any text other than the exact Hebrew lines above. ${noExtrasRule(input.direction)}`,
  ].join("\n")
}
