import Anthropic from "@anthropic-ai/sdk"
import type { SupabaseClient } from "@supabase/supabase-js"
import { readCaptionRecord } from "@/lib/caption-record"
import { cleanCaptionStyle, isCaptionedRenderUrl, isVideoMediaUrl, type CaptionRecord, type CaptionSpec } from "@/lib/own-media"
import type { ScriptText } from "@/lib/script-text"
import { AGENT_MODEL, type BRollAgentOutcome, type ChatTurn } from "@/lib/edit-agent/broll-agent"
import { extractDriveFileId, isDriveUrl } from "@/lib/drive-media"
import { fetchDriveFile } from "@/lib/drive-fetch"
import { checkFailedNote, checkTask } from "@/lib/edit-agent/self-check"
import { ownCaptionOffer } from "@/lib/own-caption-look"

/**
 * What the b-roll looks like — one still (a video at 2.8s, when the caption
 * has arrived), small JPEG base64 — so the agent sees before and after
 * instead of working blind (Hani, 2026-11-10: "שיהיה מאוד חכם כאילו אני
 * מדברת איתך").
 */
export async function stillOf(url: string, kind: "image" | "video"): Promise<string | null> {
  try {
    const res = isDriveUrl(url) ? await fetchDriveFile(extractDriveFileId(url)!) : await fetch(url, { signal: AbortSignal.timeout(60_000) })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    const sharp = (await import("sharp")).default
    if (kind === "image") return (await sharp(buf).rotate().resize(540, 960, { fit: "inside" }).jpeg({ quality: 80 }).toBuffer()).toString("base64")
    const os = await import("os")
    const fs = await import("fs/promises")
    const path = await import("path")
    const { spawn } = await import("child_process")
    const ffmpegPath = (await import("ffmpeg-static")).default as unknown as string
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "own-look-"))
    try {
      const input = path.join(dir, "in")
      const out = path.join(dir, "f.jpg")
      await fs.writeFile(input, buf)
      const grab = (at: string) =>
        new Promise<boolean>((resolve) => {
          const p = spawn(ffmpegPath, ["-y", "-ss", at, "-i", input, "-frames:v", "1", "-vf", "scale=540:-2", out])
          p.on("close", (c) => resolve(c === 0))
        })
      if (!(await grab("2.8")) && !(await grab("0"))) return null
      return (await fs.readFile(out)).toString("base64")
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  } catch {
    return null
  }
}

const imageBlock = (b64: string): Anthropic.ImageBlockParam => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } })

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

You SEE the b-roll: a still of it now comes with her message, and every set_caption / replace_media renders a draft and hands you its still. Look at it like a designer: does it do exactly what she asked (where the caption sits, how far it moved, the colours, the box)? If not, call set_caption again from the draft's state until it does — then finish. In your reply, say only what you SAW happen on the draft. Positions: "למטה/למעלה X פיקסל" = move_y ±X from where it is now; "למעלה / באמצע / למטה" alone = position.

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
        move_y: { type: "number", description: "Fine move of the whole caption from where it is NOW, in px on the 1080×1920 frame: + down, − up (\"40 פיקסל למטה\" → 40). Use for any small nudge." },
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
    kind === "image"
      ? "- On a PHOTO the caption is a still plate: position, move_y, colours, box and size work; `design` (font, shadow, motion…) does NOT apply to a photo. Never say you changed something that has no tool here — say what you can do instead."
      : "- On a VIDEO everything works: position, move_y, colours, box, size, and `design` for any other look or motion.",
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
  await input.setProgress("מסתכל על הבי-רול...")
  const nowStill = await stillOf(mediaUrl, isVideoMediaUrl(mediaUrl) ? "video" : kind)
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: [
        ...(nowStill ? [{ type: "text" as const, text: "THE B-ROLL NOW (a still):" }, imageBlock(nowStill)] : []),
        ...(imageBlocks.length ? [{ type: "text" as const, text: "HER ATTACHED PICTURES:" }, ...imageBlocks] : []),
        { type: "text", text: `${state}\n\nHER NEW MESSAGE: ${input.request}${attachNote}` },
      ],
    },
  ]
  let draft: string | null = null
  /** A video draft is only LOOKED at (a quick still); the clip is burned once, at finish, with this. */
  let videoDraft: { spec: CaptionSpec; source: string; template?: string } | null = null
  let renders = 0
  /** The newest draft's still, and the self-checks used this turn (lib/edit-agent/self-check). */
  let lastLook: string | null = null
  let checks = 0
  let newSource: { url: string; kind: "image" | "video" } | null = null
  let change = null as null | { position?: CaptionSpec["position"]; style?: CaptionSpec["style"]; design?: string }

  await input.setProgress("קורא את הבקשה...")
  for (let step = 0; step < 6; step++) {
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
      if (u.name === "finish") {
        const miss = await selfCheck(String(a.reply ?? ""))
        if (!miss) return finishWith(String(a.reply ?? ""))
        results.push({ type: "tool_result", tool_use_id: u.id, content: miss })
        continue
      }
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
        const move = typeof a.move_y === "number" && Number.isFinite(a.move_y) ? a.move_y : 0
        const baseOffset = position ? 0 : (change?.style?.offsetY ?? prev.style?.offsetY ?? 0)
        const style = cleanCaptionStyle({
          text: a.text,
          pill: a.pill,
          scale: a.scale,
          ...(move || position ? { offsetY: baseOffset + move } : {}),
        })
        const design = typeof a.design === "string" && a.design.trim() ? a.design.trim() : undefined
        change = {
          ...(change ?? {}),
          ...(position ? { position } : {}),
          ...(style && Object.keys(style).length ? { style: { ...(change?.style ?? {}), ...style } } : {}),
          ...(design ? { design } : {}),
        }
        results.push(await renderDraft(u.id))
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
          results.push(await renderDraft(u.id))
        }
      } else {
        results.push({ type: "tool_result", tool_use_id: u.id, content: "Unknown tool.", is_error: true })
      }
    }
    messages.push({ role: "user", content: results })
  }
  return finishWith("")

  /** A fresh look at the draft against her request; a note for the agent when it didn't pass. */
  async function selfCheck(reply: string): Promise<string | null> {
    if (!lastLook || !nowStill || checks >= 2) return null
    checks++
    await input.setProgress("בודק שהתוצאה עומדת בבקשה...")
    const spec = currentSpec()
    const check = await checkTask({
      apiKey: input.anthropicKey,
      media: `a vertical b-roll (1080×1920) that is her own ${newSource?.kind ?? kind}, with the script's words as a caption over it. One still of it (a video: once the caption has arrived).`,
      request: input.request,
      conversation: transcript,
      before: [{ label: "Before", jpeg: nowStill }],
      after: [{ label: "After", jpeg: lastLook }],
      rules: [
        `The caption's words are exactly the script's, nothing added or dropped (line breaks may differ): ${JSON.stringify([spec.headline, spec.body].filter(Boolean).join(" / "))}`,
        "Her photo / video itself is untouched — only the caption over it may differ (unless she attached a new file to be the b-roll).",
        ...(kind === "image" && !newSource ? ["On a photo the caption is a still plate: font, shadow and motion requests can't be done there — acceptable when the reply says so plainly."] : []),
      ],
      reply,
    })
    console.log(`[edit-agent own] ${input.postId} self-check ${checks}: ${check ? (check.met ? `met${check.preexisting.length ? ` (already there: ${check.preexisting.join(" | ")})` : ""}` : `NOT met — ${check.issues.join(" | ")}`) : "couldn't run"}`)
    if (!check) return null
    if (check.met) {
      if (!check.preexisting.length) return null
      // Passed; she only needs to hear about what was already off — no further check.
      checks = 2
      return checkFailedNote(check, true)
    }
    return checkFailedNote(check, checks >= 2)
  }

  /** The spec as it stands after her changes so far. */
  function currentSpec(): CaptionSpec {
    return {
      // The words are the script's (MEDIA TEXT IS THE SCRIPT), else what's on it.
      headline: input.script?.headline ?? prev.headline,
      body: input.script?.body ?? prev.body,
      position: change?.position ?? prev.position ?? "bottom",
      style: change?.style ? { ...prev.style, ...change.style } : prev.style,
      design: change?.design ?? prev.design,
    }
  }

  /** Render the change as a DRAFT (not saved) and hand its still back to the model. */
  async function renderDraft(toolUseId: string): Promise<Anthropic.ToolResultBlockParam> {
    if (renders >= 3) {
      return { type: "tool_result", tool_use_id: toolUseId, content: "No more drafts this turn — finish now, saying plainly what the last draft shows.", is_error: true }
    }
    renders++
    const spec = currentSpec()
    if (!spec.headline && !spec.body) {
      return { type: "tool_result", tool_use_id: toolUseId, content: "FAILED: the b-roll script has no text, so there is no caption. Tell her.", is_error: true }
    }
    const source = newSource?.url ?? record?.sourceUrl ?? mediaUrl
    const sourceKind = newSource?.kind ?? kind
    const said = `Draft with: ${JSON.stringify({ position: spec.position, style: spec.style ?? null, design: spec.design ?? null })}.`
    if (sourceKind === "video") {
      // Quick: the caption designed and drawn over ONE frame — no clip yet (Hani, 2026-11-10).
      await input.setProgress("מעצב את הכיתוב...")
      const p = await input.call<{ preview?: string; template?: string; message?: string; error?: string }>("/api/story/generate-video-media", {
        postId: input.postId,
        format: "b_roll",
        sourceUrl: source,
        persist: false,
        caption: spec,
        animated: true,
        preview: true,
      })
      if (!p.ok || !p.data.preview) {
        return { type: "tool_result", tool_use_id: toolUseId, content: `FAILED to make the draft: ${p.data.message ?? p.data.error ?? "unknown"}. Tell her plainly.`, is_error: true }
      }
      videoDraft = { spec, source, template: p.data.template }
      lastLook = p.data.preview
      return {
        type: "tool_result",
        tool_use_id: toolUseId,
        content: [
          { type: "text", text: `${said} Here is how the clip will look once the caption has arrived — compare it with her request and with the still from before. Fix with set_caption if it isn't right; otherwise finish (the clip is made then).` },
          imageBlock(p.data.preview),
        ],
      }
    }
    await input.setProgress("מעדכן את הכיתוב...")
    const r = await input.call<{ url?: string; message?: string; error?: string }>("/api/media/caption-image", {
            postId: input.postId,
            format: "b_roll",
            sourceUrl: source,
            persist: false,
            store: true,
            force: true,
            caption: spec,
          })
    if (!r.ok || !r.data.url) {
      return { type: "tool_result", tool_use_id: toolUseId, content: `FAILED to render: ${r.data.message ?? r.data.error ?? "unknown"}. Tell her plainly.`, is_error: true }
    }
    draft = r.data.url
    await input.setProgress("בודק את התוצאה...")
    const look = await stillOf(r.data.url, sourceKind)
    lastLook = look
    return {
      type: "tool_result",
      tool_use_id: toolUseId,
      content: look
        ? [{ type: "text", text: `${said} Here is its still — compare it with her request and with the still from before. Fix with set_caption if it isn't right; otherwise finish.` }, imageBlock(look)]
        : `${said} (Couldn't take a still of it.)`,
    }
  }

  async function finishWith(reply: string): Promise<BRollAgentOutcome> {
    if (videoDraft) {
      // The checked draft becomes the clip — same composition, burned once.
      await input.setProgress("צורב את הכיתוב בסרטון... זה לוקח כדקה-שתיים")
      const r = await input.call<{ url?: string; message?: string; error?: string }>("/api/story/generate-video-media", {
        postId: input.postId,
        format: "b_roll",
        sourceUrl: videoDraft.source,
        persist: false,
        caption: videoDraft.spec,
        animated: true,
        ...(videoDraft.template ? { template: videoDraft.template } : {}),
      })
      if (!r.ok || !r.data.url) return { kind: "failed", reply: r.data.message ?? "הטמעת הכיתוב בסרטון לא הצליחה הפעם, אז הבי-רול נשאר כמו שהיה. נסו שוב." }
      draft = r.data.url
    }
    if (!draft) return { kind: "done", reply: reply || "לא שיניתי כלום.", url: mediaUrl, changed: false }
    await input.setProgress("שומר...")
    const saved = await input.call<{ urls?: string[]; message?: string }>("/api/media/own-edit", {
      action: "save",
      postId: input.postId,
      format: "b_roll",
      urls: [draft],
    })
    if (!saved.ok) return { kind: "failed", reply: saved.data.message ?? "השינוי לא נשמר. נסו שוב." }
    // "זכור לעתיד" for a look change (colours, box, size): the button saves it as her caption look.
    const offer = change?.style ? ownCaptionOffer(currentSpec().style) : undefined
    return { kind: "done", reply: reply || "עדכנתי את הכיתוב.", url: draft, changed: true, ...(offer ? { rememberOffer: offer } : {}) }
  }
}
