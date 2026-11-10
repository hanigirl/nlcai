import Anthropic from "@anthropic-ai/sdk"
import type { SupabaseClient } from "@supabase/supabase-js"
import { readCaptionRecord } from "@/lib/caption-record"
import { cleanCaptionStyle, isCaptionedRenderUrl, isVideoMediaUrl, type CaptionRecord, type CaptionSpec } from "@/lib/own-media"
import type { ScriptText } from "@/lib/script-text"
import { AGENT_MODEL, type BRollAgentOutcome, type ChatTurn } from "@/lib/edit-agent/broll-agent"

/**
 * The improved AI chat on HER OWN b-roll (Hani, 2026-11-10: "תשים שם את
 * הצ׳אט המשופר, אפילו שזה לדברים קטנים"): the same agent conversation — it
 * answers, remembers, asks — but its only tool on her media is the caption's
 * look: position, the words' colour, the box behind them, size. Her pixels
 * and the words (the script) are out of its reach — no tool exists for them.
 *
 * The caption is drawn again over the ORIGINAL file (its caption record), by
 * the same routes the panel uses, so it never stacks.
 */

export interface OwnBRollAgentInput {
  db: SupabaseClient
  postId: string
  anthropicKey: string
  mediaUrl: string
  script: ScriptText | null
  history: ChatTurn[]
  request: string
  /** Pictures she attached to THIS message (data URLs) — references, or a new file for the media. */
  attached?: string[]
  /** The same pictures, stored (public URLs), same order. */
  attachedUrls?: string[]
  /** Per attached picture, when it is a VIDEO's frame: "drive:<id>" or "storage:<path>". */
  attachedVideos?: (string | null)[]
  /** Public URL for one of her storage paths. */
  publicUrl?: (path: string) => string
  setProgress: (text: string) => Promise<void>
  /** POST to one of our routes as her (her cookies), → JSON. */
  call: <T>(path: string, body: unknown) => Promise<{ ok: boolean; data: T }>
}

const SYSTEM = `You are the AI edit chat of a content app, on ONE b-roll that is the creator's OWN media (a video or photo she filmed / brought from her Google Drive or computer), with the post's script as a caption over it. She writes in Hebrew.

You talk with her like a sharp, warm, flexible designer colleague: you understand what she means (also loose or partial wording), infer the unstated from context and the whole conversation, remember what was said and done, and answer questions plainly. Not every message is an edit — when she asks something, just answer (finish).

What you control — EVERYTHING about the caption (the script's words over her media):
- position (top / center / bottom), colour of the words, the box behind them (a colour or none), size;
- and any other look or motion of the caption through \`design\` — font weight, letter spacing, line breaks, a rounded / pill / sharp box, outline, shadow, glow, highlight of a word, one box per line or one block, how it enters and moves (on a video), anything she describes. Write \`design\` as a precise instruction for the caption designer, in her words plus whatever detail makes it unambiguous. When she attaches a reference picture of a look she wants, read it and describe that look in \`design\` (and set position / colours / size to match).
- replace_media: when she attaches a photo or video of hers and wants it AS the b-roll (instead of the current one), put it in; the caption is drawn over it again.
What you never do: change, retouch, recolour, crop or redraw her photo/video pixels, and never change the words (they are the post's script — changed in the script editor). If she asks for that, say so in one kind sentence and offer what you can do.

Act with set_caption / replace_media, then finish. Several changes in one turn are fine. Only when her request truly has several readings, ask_user with 2–4 short options. Colours: her brand colours when she says "צבע המותג"; otherwise real hex values for what she named.

finish.reply: Hebrew, plural forms (אתם / נסו), 1–2 short sentences, natural spoken Hebrew, saying what's on the card now (she reads it after the change is done). No emojis, no markdown.`

const TOOLS: Anthropic.Tool[] = [
  {
    name: "set_caption",
    description: "Change the caption's look. Send only the fields she asked to change.",
    input_schema: {
      type: "object",
      properties: {
        position: { type: "string", enum: ["top", "center", "bottom"] },
        text: { type: "string", description: "#hex colour of the words" },
        pill: { type: "string", description: "#hex colour of the box behind the words, or \"none\"" },
        scale: { type: "number", minimum: 0.6, maximum: 1.5 },
        design: { type: "string", description: "Any other look / motion of the caption, as a precise instruction (Hebrew or English). It REPLACES the earlier design wording, so include what should stay from it." },
      },
    },
  },
  {
    name: "replace_media",
    description: "Use a photo or video she attached to THIS message as the b-roll itself (instead of the current one). The caption is drawn over it again.",
    input_schema: { type: "object", properties: { attached: { type: "integer", minimum: 1 } }, required: ["attached"] },
  },
  {
    name: "ask_user",
    description: "Ask her a short question with 2–4 options (Hebrew).",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string" },
        options: { type: "array", items: { type: "object", properties: { label: { type: "string" }, action: { type: "string" } }, required: ["label", "action"] } },
      },
      required: ["question", "options"],
    },
  },
  {
    name: "finish",
    description: "End the turn with your reply to her.",
    input_schema: { type: "object", properties: { reply: { type: "string" } }, required: ["reply"] },
  },
]

export async function runOwnBRollAgent(input: OwnBRollAgentInput): Promise<BRollAgentOutcome> {
  const { mediaUrl } = input
  const record: CaptionRecord | null = isCaptionedRenderUrl(mediaUrl) ? await readCaptionRecord(input.db, mediaUrl) : null
  if (isCaptionedRenderUrl(mediaUrl) && !record) {
    return {
      kind: "failed",
      reply: "את הכיתוב הזה אי אפשר לשנות, כי הקובץ המקורי בלי הכיתוב לא נשמר. חברו את הבי-רול שוב מהדרייב, ומשם אפשר לשנות אותו כמה שתרצו.",
    }
  }
  const prev: CaptionSpec = record?.caption ?? {}
  const kind = isVideoMediaUrl(record?.sourceUrl ?? mediaUrl) ? "video" : "image"

  const transcript = input.history.length
    ? input.history.map((t) => `${t.role === "user" ? "HER" : "YOU"}: ${t.text}`).join("\n")
    : "(this is the first message)"
  const state = [
    `THE B-ROLL: her own ${kind}.`,
    `- Caption now: ${record ? JSON.stringify({ position: prev.position ?? "bottom", style: prev.style ?? "default (white words on a black box)", design: prev.design ?? null }) : "none yet (the script will be put on it)"}`,
    `- The words (the script — not changeable here): ${JSON.stringify([input.script?.headline, input.script?.body].filter(Boolean).join(" / ") || "(no script text)")}`,
    "",
    "THE CONVERSATION SO FAR:",
    transcript,
  ].join("\n")

  const client = new Anthropic({ apiKey: input.anthropicKey })
  const attached = input.attached ?? []
  const imageBlocks: Anthropic.ImageBlockParam[] = attached.flatMap((d) => {
    const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/.exec(d)
    return m ? [{ type: "image" as const, source: { type: "base64" as const, media_type: m[1] as "image/png", data: m[2] } }] : []
  })
  const attachNote = attached.length
    ? `\n\nShe attached ${attached.length} picture${attached.length > 1 ? "s" : ""} (shown above, numbered in order)${(input.attachedVideos ?? []).some(Boolean) ? "; " + (input.attachedVideos ?? []).map((v, i) => (v ? `#${i + 1} is the first frame of a VIDEO` : null)).filter(Boolean).join(", ") : ""}.`
    : ""
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: [...imageBlocks, { type: "text", text: `${state}\n\nHER NEW MESSAGE: ${input.request}${attachNote}` }] },
  ]
  let newSource: { url: string; kind: "image" | "video" } | null = null
  let change = null as null | { position?: CaptionSpec["position"]; style?: CaptionSpec["style"]; design?: string }

  await input.setProgress("קורא את הבקשה...")
  for (let step = 0; step < 4; step++) {
    const res = await client.messages.create({ model: AGENT_MODEL, max_tokens: 1200, system: SYSTEM, tools: TOOLS, messages })
    messages.push({ role: "assistant", content: res.content })
    const uses = res.content.filter((c): c is Anthropic.ToolUseBlock => c.type === "tool_use")
    if (!uses.length) {
      const text = res.content.map((c) => (c.type === "text" ? c.text : "")).join("").trim()
      return finishWith(text || "לא היה מה לשנות.")
    }
    const results: Anthropic.ToolResultBlockParam[] = []
    for (const u of uses) {
      const a = (u.input ?? {}) as Record<string, unknown>
      if (u.name === "finish") return finishWith(String(a.reply ?? ""))
      if (u.name === "ask_user") {
        const options = Array.isArray(a.options)
          ? (a.options as { label?: unknown; action?: unknown }[])
              .map((o) => ({ label: String(o.label ?? ""), action: String(o.action ?? o.label ?? "") }))
              .filter((o) => o.label)
              .slice(0, 4)
          : []
        return { kind: "ask", question: String(a.question ?? ""), options }
      }
      if (u.name === "set_caption") {
        const position = a.position === "top" || a.position === "center" || a.position === "bottom" ? a.position : undefined
        const style = cleanCaptionStyle({ text: a.text, pill: a.pill, scale: a.scale })
        const design = typeof a.design === "string" && a.design.trim() ? a.design.trim() : undefined
        change = {
          ...(change ?? {}),
          ...(position ? { position } : {}),
          ...(style && Object.keys(style).length ? { style: { ...(change?.style ?? {}), ...style } } : {}),
          ...(design ? { design } : {}),
        }
        results.push({ type: "tool_result", tool_use_id: u.id, content: "Noted (applied when you finish). Now finish with your reply." })
      } else if (u.name === "replace_media") {
        const n = Number(a.attached) - 1
        const video = input.attachedVideos?.[n] ?? null
        const url = video
          ? video.startsWith("drive:")
            ? `https://drive.google.com/file/d/${video.slice(6)}/view`
            : input.publicUrl?.(video.slice(8)) ?? null
          : input.attachedUrls?.[n] ?? null
        if (!url) {
          results.push({ type: "tool_result", tool_use_id: u.id, content: `FAILED: no attached file ${a.attached}.`, is_error: true })
        } else {
          newSource = { url, kind: video ? "video" : "image" }
          change = change ?? {}
          results.push({ type: "tool_result", tool_use_id: u.id, content: "Noted: that file becomes the b-roll (applied when you finish)." })
        }
      } else {
        results.push({ type: "tool_result", tool_use_id: u.id, content: "Unknown tool.", is_error: true })
      }
    }
    messages.push({ role: "user", content: results })
  }
  return finishWith("")

  async function finishWith(reply: string): Promise<BRollAgentOutcome> {
    if (!change) return { kind: "done", reply: reply || "לא שיניתי כלום.", url: mediaUrl, changed: false }
    const spec: CaptionSpec = {
      // The words are the script's (MEDIA TEXT IS THE SCRIPT), else what's on it.
      headline: input.script?.headline ?? prev.headline,
      body: input.script?.body ?? prev.body,
      position: change.position ?? prev.position ?? "bottom",
      style: change.style ? { ...prev.style, ...change.style } : prev.style,
      design: change.design ?? prev.design,
    }
    if (!spec.headline && !spec.body) {
      return { kind: "failed", reply: "אין טקסט בסקריפט של הבי-רול, אז אין כיתוב לעצב. כתבו את הסקריפט ונסו שוב." }
    }
    const source = newSource?.url ?? record?.sourceUrl ?? mediaUrl
    const sourceKind = newSource?.kind ?? kind
    await input.setProgress(sourceKind === "video" ? "מעדכן את הכיתוב בסרטון..." : "מעדכן את הכיתוב...")
    const r =
      sourceKind === "video"
        ? await input.call<{ url?: string; message?: string; error?: string }>("/api/story/generate-video-media", {
            postId: input.postId,
            format: "b_roll",
            sourceUrl: source,
            persist: false,
            caption: spec,
            animated: true,
          })
        : await input.call<{ url?: string; message?: string; error?: string }>("/api/media/caption-image", {
            postId: input.postId,
            format: "b_roll",
            sourceUrl: source,
            persist: false,
            store: true,
            force: true,
            caption: spec,
          })
    if (!r.ok || !r.data.url) return { kind: "failed", reply: r.data.message ?? "עדכון הכיתוב לא הצליח הפעם, אז הבי-רול נשאר כמו שהיה. נסו שוב." }
    await input.setProgress("שומר...")
    const saved = await input.call<{ urls?: string[]; message?: string }>("/api/media/own-edit", {
      action: "save",
      postId: input.postId,
      format: "b_roll",
      urls: [r.data.url],
    })
    if (!saved.ok) return { kind: "failed", reply: saved.data.message ?? "השינוי לא נשמר. נסו שוב." }
    return { kind: "done", reply: reply || "עדכנתי את הכיתוב.", url: r.data.url, changed: true }
  }
}
