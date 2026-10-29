import Anthropic from "@anthropic-ai/sdk"
import {
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
 * with a short list of operations from a closed set — caption, slides,
 * order. It never gets an operation that repaints her pixels, so a request
 * for one can only come back as a kind refusal.
 */

const NOUN: Record<OwnEditFormat, { item: string; set: string }> = {
  story: { item: "frame", set: "Instagram story" },
  carousel: { item: "slide", set: "Instagram carousel" },
  image_post: { item: "image", set: "single Instagram feed image" },
  b_roll: { item: "clip", set: "b-roll reel (one clip or still)" },
}

function describeFrame(f: OwnFrameInfo, i: number): string {
  const who = f.aiMade ? "AI-made slide (added earlier)" : `HER OWN ${f.kind === "video" ? "video" : "photo/image"}`
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
  const isSet = isSetFormat(format)
  const client = new Anthropic({ apiKey })
  const ops = [
    `{"op":"set_caption","frames":[1..${n}],"headline"?:string,"body"?:string,"position"?:"top"|"center"|"bottom","style"?:{"pill"?:"#hex"|"none","text"?:"#hex","scale"?:0.6-1.5}} — add, rewrite, restyle or move the caption. Omitted fields keep the frame's current caption values; to change only the position or look, send only those. Text must be natural spoken Hebrew, short.`,
    `{"op":"remove_caption","frames":[...]} — take our caption off (back to her file as she brought it).`,
    ...(isSet
      ? [
          `{"op":"add_slide","after":0..${n},"headline"?:string,"body"?:string,"role"?:"closing"|"content"|"cover"} — a NEW ${NOUN[format].item} designed by AI in her visual language, inserted after that position (0 = first). Write its Hebrew text from the post when she doesn't dictate it (a closing frame = a short CTA from the post).`,
          `{"op":"remove_slide","frames":[...]}`,
          `{"op":"duplicate_slide","frame":k}`,
          `{"op":"reorder","order":[the full new order, a permutation of 1..${n}]}`,
        ]
      : []),
  ]
  const system = [
    "You plan edits on social media that a Hebrew-speaking creator FILMED OR PHOTOGRAPHED HERSELF. The rule: you may add on top of her media or take away from it — the caption over it, extra AI-made slides, the order — but you NEVER change, regenerate, repaint, retouch, recolour, crop, filter or 'fix' her own photo or video pixels.",
    "If she asks for something that would change her own pixels (brighter, remove an object, change the background, make her look different, improve the photo…), do NOT plan it: return no ops, refused:true, and a kind one-line Hebrew reply saying you can't change what she filmed/photographed, plus what you CAN do instead.",
    "If her request is unclear, return no ops and a short Hebrew question in reply.",
    "Reply with JSON only: {\"reply\": \"one short Hebrew line, plural addressing (אתם), saying what you did / why not\", \"ops\": [...], \"refused\"?: true}.",
    "Never stack a second caption over words that are already there: a frame marked as already having its own words gets no caption unless she explicitly asks to put text on it.",
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
      formatText: input.post.formatBody?.slice(0, 1500) ?? null,
      coreText: input.post.formatBody ? undefined : input.post.body?.slice(0, 1500),
    }),
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
  return {
    reply: typeof json.reply === "string" && json.reply.trim() ? json.reply.trim() : "",
    ops: sanitiseOps(json.ops, n, isSet),
    refused: json.refused === true || undefined,
  }
}

const inRange = (v: unknown, n: number) => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= n

function frameList(v: unknown, n: number): number[] {
  const list = Array.isArray(v) ? v.filter((x) => inRange(x, n)) : []
  return Array.from(new Set(list as number[]))
}

/** Drop anything outside the closed set or pointing at frames that don't exist. */
export function sanitiseOps(raw: unknown, n: number, isSet: boolean): OwnEditOp[] {
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
      case "add_slide": {
        if (!isSet) break
        const after = typeof o.after === "number" ? Math.min(n, Math.max(0, Math.round(o.after))) : n
        const role = o.role === "closing" || o.role === "content" || o.role === "cover" ? o.role : undefined
        out.push({ op: "add_slide", after, headline: str(o.headline), body: str(o.body), role })
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
