import Anthropic from "@anthropic-ai/sdk"
import type { SupabaseClient } from "@supabase/supabase-js"
import sharp from "sharp"
import { readCaptionRecord } from "@/lib/caption-record"
import { captionLookFor } from "@/lib/caption-look"
import { cleanCaptionStyle, isCaptionedRenderUrl, isOwnMediaUrl, isVideoMediaUrl, type CaptionSpec, type CaptionStyle } from "@/lib/own-media"
import { scriptTextUnits, type ScriptText } from "@/lib/script-text"
import { storyFrames } from "@/lib/story-text-split"
import { editImage, generateImage } from "@/lib/openai-image"
import { editPrompt } from "@/lib/ai-edit-plan"
import { referenceBuffer } from "@/lib/ai-edit-references"
import { loadImageForModels, normaliseImage, type ModelImage } from "@/lib/visual-language/image-input"
import { picturesPlaced } from "@/lib/placed-check"
import { pickComposition, resolveDesignDirection } from "@/lib/visual-language/direction"
import { withGraphicOnly } from "@/lib/visual-language/graphic-only"
import { withMediaBrief } from "@/lib/media-brief"
import { applyFixedElements } from "@/lib/visual-language/fixed-elements"
import { buildStoryPrompt, cropStoryToCanvas, frameRole } from "@/lib/story-frame-prompt"
import { replaceStyleRules, triageVisualMemory } from "@/lib/style-memory"
import { isRuleScope } from "@/lib/visual-memory"
import { AGENT_MODEL, type BRollAgentOutcome, type ChatTurn } from "@/lib/edit-agent/broll-agent"
import { stillOf } from "@/lib/edit-agent/own-broll-agent"

/**
 * The AI edit chat for a STORY, as an agent (Hani, 2026-11-10: "נכניס אותו
 * לעריכת סטורי בין אם מדיה קיימת ובין אם שפה ויזואלית לפי החוקים הקיימים
 * בבירול"). The b-roll agent's rules, frame by frame — a story is a set, and
 * each frame is one of two things:
 *
 *   - DESIGNED: a frame we drew in her visual language (the words are part of
 *     the picture). The agent may change the design, work her picture into
 *     it, or draw it again — the b-roll agent's design / background tools.
 *   - HER OWN: her photo or video with the script's words over it. Only the
 *     caption's look and place change, or the file is swapped for another of
 *     hers — her pixels are never touched (the own-b-roll agent's rules; no
 *     tool here can reach them).
 *
 * The words on every frame are that frame's part of the script, verbatim.
 * Nothing is saved until finish; it looks at every draft before answering.
 */

const THINK_BUDGET_MS = 420_000
const MAX_STEPS = 12
const MAX_DRAFTS = 12

export interface StoryAgentInput {
  /** Service client — storage and reads. */
  db: SupabaseClient
  userId: string
  email: string | null | undefined
  postId: string
  anthropicKey: string
  openaiKey: string | null
  canBlend: boolean
  /** The story's frames as saved, in order. */
  urls: string[]
  /** The story script (format_variants.body). */
  scriptBody: string | null
  history: ChatTurn[]
  request: string
  /** Pictures she attached to THIS message (data URLs). */
  attached: string[]
  /** Per attached picture, when it is a VIDEO's frame: "drive:<id>" or "storage:<path>". */
  attachedVideos?: (string | null)[]
  publicUrl: (path: string) => string
  setProgress: (text: string) => Promise<void>
  /** POST to one of our routes as her (her cookies), → JSON. */
  call: <T>(path: string, body: unknown) => Promise<{ ok: boolean; data: T }>
}

type FrameKind = "designed" | "own" | "locked"

interface Frame {
  kind: FrameKind
  media: "image" | "video"
  /** What the post holds now. */
  url: string
  lockedWhy?: string
  /** own: the file as she brought it, and the caption drawn over it. */
  source?: string
  spec?: CaptionSpec
  /** Drafts — nothing here is saved before finish. */
  draftPng?: Buffer
  draftUrl?: string
  videoDraft?: { spec: CaptionSpec; source: string; template?: string; animated: boolean }
  /** The newest look of the draft (small JPEG, base64). */
  look?: string
  dirty: boolean
}

type Block = Anthropic.ContentBlockParam
const jpeg = (b64: string): Block => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } })
function dataUrlBlock(url: string): Block {
  const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/.exec(url)
  if (!m) return { type: "text", text: "(an image that couldn't be read)" }
  return { type: "image", source: { type: "base64", media_type: m[1] as "image/png", data: m[2] } }
}
const small = async (png: Buffer) =>
  (await sharp(png).resize(540, 960, { fit: "inside" }).jpeg({ quality: 80 }).toBuffer()).toString("base64")

/** Share of the picture that visibly changed, 0..1 (lib/ai-edit-plan changedArea, on buffers). */
async function changedShare(before: Buffer, after: Buffer): Promise<number> {
  const grid = (input: Buffer) => sharp(input).greyscale().resize(54, 96, { fit: "fill" }).raw().toBuffer()
  const [a, b] = await Promise.all([grid(before), grid(after)])
  let moved = 0
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 24) moved++
  return moved / a.length
}

const SYSTEM = `You are the AI edit chat of a content app, working on ONE Instagram STORY: an ordered set of vertical frames (1080×1920), each carrying its own part of the post's script. The creator writes in Hebrew.

You talk with her like a sharp, warm designer colleague: you understand what she means (also loose or partial wording), infer the unstated from context and the whole conversation, remember what was said and done, and can explain why something did or didn't work. When she asks a question or wants to talk it through, just answer (finish) — not every message is an edit.

Every frame is one of two kinds (stated per frame below), and each kind has its own tools:

DESIGNED frames — drawn by us in her visual language; the words are part of the picture.
- edit_design: change the design in place — move / resize / recolour the text or an element, change the background, add or remove a graphic element, spacing, alignment. Write a precise instruction: what changes, where to (in words and rough proportions), and what stays.
- blend_picture: work a picture she attached to THIS message into the frame's design (her subject stays recognisably the same). Say where and how big.
- redraw_frame: draw the frame again from scratch in her CURRENT visual language (optionally steered) — for "השפה שלי", "תעשה חדש", or when edits keep coming out wrong.

HER OWN frames — her photo or video, with the script's words as a caption over it.
- set_caption: everything about the caption — position (top / center / bottom), a fine move in pixels, the words' colour, the box behind them (a colour or none), size; on a VIDEO also \`design\` for any other look or motion (font weight, shadow, outline, how it enters). On a PHOTO \`design\` does not apply.
- You never change, retouch, recolour, crop or redraw her photo / video pixels. If she asks for that, say so in one kind sentence and offer what you can do.

Any frame:
- use_as_is: put a photo or video she attached to THIS message in as that frame's media exactly as it is — full frame, with the script's words drawn over it (the frame becomes HER OWN). Use it when she wants her picture as the frame / as the background / "כמו שהיא", or to swap the file of one of her own frames.
- Her picture can go in two ways: worked INTO a designed frame (blend_picture) or AS the frame (use_as_is). When her words don't say which, ask.

Rules that always hold:
- The words on each frame are that frame's part of the script, word for word (given below). Never invent, add, translate, shorten or drop words — no titles, no CTA. You change how they look and where they sit, never what they say. To change the words she edits the script.
- No invented people: never add a face, person or figure on your own. A person appears only from a picture she attached.
- Instagram covers the top ~14% (profile bar) and the bottom ~24% (reply bar) of a story: keep text and key elements out of there unless she insists, and tell her when a request puts text under them.
- Which frame: "פריים 2", "הראשון", "האחרון" are clear. A look change with no frame named (colours, position, size, font) applies to every frame it can. Putting a picture in, or a change that fits only one frame, with no frame named and more than one candidate: ask.
- Tools change a DRAFT. Nothing is saved until you finish. You SEE the story: stills of every frame come with her message, and every change hands you the new draft. Look at it like a designer: is it exactly what she asked (where things sit, how far they moved, the colours)? On a designed frame also read the Hebrew: every word of the script must still be there, spelled right, in order, nothing added. If not, fix it (another step) and look again — when an edit keeps breaking the words, redraw_frame. Only then finish.
- When her request has more than one reasonable reading, ask_user with 2–4 short Hebrew options. Don't ask when the answer is clear.
- Her saved preferences (Settings → מדיה → העדפות ויזואליות) shape every future story. When she asks to save / remember / keep something ("תשמור", "ככה ארצה שיהיו", "מעכשיו"), call remember with a precise description of exactly that, read off the frames. One call per distinct thing. In your reply name as saved ONLY what a remember result said SAVED.
- Tool results tell you when a step failed and why. Never claim something happened that didn't; say only what you SAW on the draft.
- "זכור לעתיד": when your change is a look choice that could hold for her future stories — on DESIGNED frames only (her saved preferences shape what we draw, not the caption on her own media) — set finish.remember_offer (she gets a button; pressing it asks you to save exactly that with remember). Don't mention the button in your reply, and don't offer what was already saved.

finish.reply: Hebrew, plural forms (אתם / נסו), 1–3 short sentences, natural spoken Hebrew. Say what you actually did and on which frames; if something didn't work, say plainly what and why, and what she can do. She reads it after the change is saved and already on her card — never say it will appear later. No emojis, no markdown.`

const FRAMES_PROP = {
  type: "array",
  items: { type: "integer", minimum: 1 },
  description: "Frame numbers (1-based), in the story's order.",
} as const

const TOOLS: Anthropic.Tool[] = [
  {
    name: "look_at_frames",
    description: "See the current draft of the frames (all of them, or the ones you name).",
    input_schema: { type: "object", properties: { frames: FRAMES_PROP } },
  },
  {
    name: "edit_design",
    description: "DESIGNED frames only: change the design in place (text position / size / colour, elements, background, layout). The words stay the script's. Returns the new draft.",
    input_schema: {
      type: "object",
      properties: { frames: FRAMES_PROP, instruction: { type: "string", description: "English, precise: what to change, where to, and what to keep." } },
      required: ["frames", "instruction"],
    },
  },
  {
    name: "blend_picture",
    description: "DESIGNED frame only: work a picture she attached to THIS message into the frame's design. Returns the new draft.",
    input_schema: {
      type: "object",
      properties: {
        frame: { type: "integer", minimum: 1 },
        attached: { type: "integer", minimum: 1 },
        how: { type: "string", description: "English: where it goes, how big, how it sits with the text." },
      },
      required: ["frame", "attached", "how"],
    },
  },
  {
    name: "redraw_frame",
    description: "DESIGNED frames only: draw them again from scratch in her current visual language, with the script's words. Returns the new draft.",
    input_schema: {
      type: "object",
      properties: { frames: FRAMES_PROP, direction: { type: "string", description: "Optional steer for the look (Hebrew or English)." } },
      required: ["frames"],
    },
  },
  {
    name: "set_caption",
    description: "HER OWN frames only: change the caption's look / place. Send only the fields she asked to change. Returns the new draft.",
    input_schema: {
      type: "object",
      properties: {
        frames: FRAMES_PROP,
        position: { type: "string", enum: ["top", "center", "bottom"] },
        text: { type: "string", description: "#hex colour of the words" },
        pill: { type: "string", description: "#hex colour of the box behind the words, or \"none\"" },
        scale: { type: "number", minimum: 0.6, maximum: 1.5 },
        move_y: { type: "number", description: "Fine move from where it is NOW, px on the 1080×1920 frame: + down, − up (\"40 פיקסל למטה\" → 40)." },
        design: { type: "string", description: "VIDEO frames only: any other look / motion of the caption, a precise instruction. It REPLACES the earlier design wording." },
      },
      required: ["frames"],
    },
  },
  {
    name: "use_as_is",
    description: "Any frame: put a photo / video she attached to THIS message in as the frame's media exactly as it is, the script's words drawn over it. Returns the new draft.",
    input_schema: {
      type: "object",
      properties: { frame: { type: "integer", minimum: 1 }, attached: { type: "integer", minimum: 1 } },
      required: ["frame", "attached"],
    },
  },
  {
    name: "remember",
    description: "Save a lasting preference for her future stories (shown in her Settings → העדפות ויזואליות). Precise and concrete, from what is on the frames now. One call per distinct preference.",
    input_schema: {
      type: "object",
      properties: {
        what: { type: "string" },
        scope: { type: "string", enum: ["story", "all"], description: "story unless she said it's for all her formats." },
      },
      required: ["what"],
    },
  },
  {
    name: "replace_preferences",
    description: "After remember reported a conflict and she chose the new one: replace the old preferences with it.",
    input_schema: {
      type: "object",
      properties: {
        replace_ids: { type: "array", items: { type: "string" } },
        rule: { type: "string" },
        summary_he: { type: "string" },
        scope: { type: "string", enum: ["story", "all"] },
      },
      required: ["replace_ids", "rule", "summary_he"],
    },
  },
  {
    name: "ask_user",
    description: "Ask her instead of guessing. One short Hebrew question, 2–4 options (each a short Hebrew label; action = what choosing it means). Ends this turn.",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string" },
        options: {
          type: "array",
          minItems: 2,
          maxItems: 4,
          items: { type: "object", properties: { label: { type: "string" }, action: { type: "string" } }, required: ["label", "action"] },
        },
      },
      required: ["question", "options"],
    },
  },
  {
    name: "finish",
    description: "End this turn with your reply to her (see the system rules for the reply).",
    input_schema: {
      type: "object",
      properties: {
        reply: { type: "string" },
        remember_offer: {
          type: "string",
          description:
            "Optional. Set ONLY when this turn changed the LOOK in a way that reads as her taste and could hold for her future pieces (a colour choice, where text sits, sizes, a way of emphasising, a motion style) — then write that preference precisely and generally, as a rule a designer could follow next time (not this piece's words or picture). She gets a \"זכור לעתיד\" button that saves it. Leave out for one-off fixes, content-specific changes, questions, failures, or when you already saved it with remember this turn.",
        },
      },
      required: ["reply"],
    },
  },
]

export async function runStoryAgent(input: StoryAgentInput): Promise<BRollAgentOutcome> {
  const { db, userId, postId, anthropicKey, openaiKey } = input
  const started = Date.now()
  const client = new Anthropic({ apiKey: anthropicKey })
  const total = input.urls.length
  let drafts = 0
  /** A preference saved this turn — then no "זכור לעתיד" offer. */
  let remembered = false
  let offer: string | undefined

  /* ------------------------------ the frames ------------------------------ */
  const units: (ScriptText | null)[] = scriptTextUnits("story", input.scriptBody)
  // A designed set is split the generator's way; when the script's own split
  // has another count, that split (asked for this many frames) is the text.
  const designedTexts =
    units.length === total
      ? units.map((u) => [u?.headline, u?.body].filter(Boolean).join("\n"))
      : input.scriptBody?.trim()
        ? storyFrames(input.scriptBody, total)
        : []
  const look: CaptionStyle = await captionLookFor(db, userId)

  const frames: Frame[] = await Promise.all(
    input.urls.map(async (url): Promise<Frame> => {
      const media = isVideoMediaUrl(url) ? "video" : "image"
      if (!isOwnMediaUrl(url)) {
        if (media === "video") {
          return { kind: "locked", media, url, dirty: false, lockedWhy: "an animated clip made earlier — it can't be edited here, only replaced (use_as_is)" }
        }
        return { kind: "designed", media, url, dirty: false }
      }
      const captioned = isCaptionedRenderUrl(url)
      const record = captioned ? await readCaptionRecord(db, url) : null
      if (captioned && !record) {
        return { kind: "locked", media, url, dirty: false, lockedWhy: "her file with an older caption whose original wasn't kept — the caption can't be changed; she can connect the file again, or you can replace it (use_as_is)" }
      }
      return { kind: "own", media, url, source: record?.sourceUrl ?? url, spec: record?.caption ?? undefined, dirty: false }
    }),
  )

  const scriptOf = (i: number): ScriptText | null => units[i] ?? null
  const wordsOf = (i: number): string =>
    frames[i].kind === "designed"
      ? (designedTexts[i] ?? "")
      : [scriptOf(i)?.headline ?? frames[i].spec?.headline, scriptOf(i)?.body ?? frames[i].spec?.body].filter(Boolean).join(" / ")

  /** The frame as it stands (draft, else saved) → a small still. */
  async function lookOf(i: number): Promise<string | null> {
    const f = frames[i]
    if (f.look) return f.look
    if (f.draftPng) return (f.look = await small(f.draftPng))
    return stillOf(f.draftUrl ?? f.url, f.draftUrl ? "image" : f.media)
  }
  async function stillBlocks(indexes: number[], lead: string): Promise<Block[]> {
    const shots = await Promise.all(indexes.map((i) => lookOf(i)))
    const out: Block[] = [{ type: "text", text: lead }]
    indexes.forEach((i, k) => {
      out.push({ type: "text", text: `Frame ${i + 1}${frames[i].dirty ? " (draft)" : ""}:` })
      out.push(shots[k] ? jpeg(shots[k]!) : { type: "text", text: "(couldn't take a still of it)" })
    })
    return out
  }

  const describe = (f: Frame, i: number): string => {
    const words = JSON.stringify(wordsOf(i) || "(the script has no text for this frame)")
    if (f.kind === "designed") return `Frame ${i + 1}: DESIGNED in her visual language (a picture, words drawn in). Script words — exactly these: ${words}`
    if (f.kind === "locked") return `Frame ${i + 1}: LOCKED — ${f.lockedWhy}.`
    const cap = f.spec
      ? JSON.stringify({ position: f.spec.position ?? "bottom", style: f.spec.style ?? "default (white words, a box per line)", design: f.spec.design ?? null })
      : "none yet"
    return `Frame ${i + 1}: HER OWN ${f.media === "video" ? "VIDEO" : "PHOTO"}. Caption now: ${cap}. Script words — exactly these: ${words}`
  }

  const transcript = input.history.length
    ? input.history
        .map((t) => `${t.role === "user" ? "HER" : "YOU"}: ${t.text}${t.images ? ` [attached ${t.images} picture${t.images > 1 ? "s" : ""}]` : ""}`)
        .join("\n")
    : "(this is the first message)"

  await input.setProgress("מסתכל על הסטורי...")
  const attachNote = input.attached.length
    ? (input.attachedVideos ?? []).some(Boolean)
      ? ` (${(input.attachedVideos ?? []).map((v, i) => (v ? `#${i + 1} is the first frame of a VIDEO — use_as_is puts the video itself in` : null)).filter(Boolean).join("; ")})`
      : ""
    : ""
  const first: Block[] = [
    {
      type: "text",
      text: [
        `THE STORY NOW — ${total} frame${total > 1 ? "s" : ""}:`,
        ...frames.map(describe),
        "",
        "THE CONVERSATION SO FAR:",
        transcript,
      ].join("\n"),
    },
    ...(await stillBlocks(frames.map((_, i) => i), "The frames now:")),
    ...input.attached.flatMap((a, i): Block[] => [{ type: "text", text: `Attached picture ${i + 1} (with this message):` }, dataUrlBlock(a)]),
    { type: "text", text: `HER MESSAGE NOW:\n${input.request}${attachNote}` },
  ]
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: first }]

  const CHECK = "Compare with her request and with the frame before. On a designed frame read the Hebrew: it must be exactly the script's words. Fix if it isn't right; otherwise finish."
  const asModel = (png: Buffer): Promise<ModelImage> => normaliseImage(png)
  const wordsRule = (i: number) =>
    designedTexts[i]
      ? `\n\nThe Hebrew text on this frame is EXACTLY this, right-to-left, every word, same spelling, nothing added or dropped (it may move, resize or recolour only as asked above):\n"""${designedTexts[i]}"""`
      : ""
  const openai = () => {
    if (!openaiKey) throw new Error("openai_missing")
    return openaiKey
  }

  for (let step = 0; step < MAX_STEPS; step++) {
    const overTime = Date.now() - started > THINK_BUDGET_MS
    await input.setProgress(step === 0 ? "חושב מה לעשות..." : "ממשיך...")
    const res = await client.messages
      .stream({
        model: AGENT_MODEL,
        max_tokens: 4000,
        system: SYSTEM,
        tools: overTime ? TOOLS.filter((t) => t.name === "finish" || t.name === "ask_user") : TOOLS,
        // Opus 5.5 takes no forced tool choice; a plain-text answer is her reply.
        tool_choice: { type: "auto" },
        messages,
      })
      .finalMessage()
    messages.push({ role: "assistant", content: res.content })
    const calls = res.content.filter((c): c is Anthropic.ToolUseBlock => c.type === "tool_use")
    if (!calls.length) {
      const said = res.content
        .filter((c): c is Anthropic.TextBlock => c.type === "text")
        .map((c) => c.text)
        .join("\n")
        .trim()
      return finishRun(said || (anyDirty() ? "עשיתי את השינויים." : "לא הצלחתי להבין מה לעשות. אפשר לנסח שוב?"))
    }

    const results: Block[] = []
    // A finish / ask beside other calls waits for them: the work is done first.
    let ending: BRollAgentOutcome | "finish" | null = null
    let finishReply = ""
    for (const call of calls) {
      const a = (call.input ?? {}) as Record<string, unknown>
      if (call.name === "finish") {
        ending = ending ?? "finish"
        finishReply = String(a.reply ?? "").trim() || "סיימתי."
        offer = typeof a.remember_offer === "string" && a.remember_offer.trim() ? a.remember_offer.trim().slice(0, 1200) : undefined
        continue
      }
      if (call.name === "ask_user") {
        const options = Array.isArray(a.options)
          ? (a.options as { label?: unknown; action?: unknown }[])
              .map((o) => ({ label: String(o.label ?? "").trim(), action: String(o.action ?? o.label ?? "").trim() }))
              .filter((o) => o.label)
              .slice(0, 4)
          : []
        ending = { kind: "ask", question: String(a.question ?? "").trim(), options }
        continue
      }
      let out: string | Block[]
      // What it did, step by step — the trail a "why did it do that" starts from.
      console.log(`[story-agent] ${postId} step ${step + 1}: ${call.name} ${JSON.stringify(a).slice(0, 600)}`)
      // A step that breaks midway leaves no half-made draft behind.
      const before = frames.map((f) => ({ ...f }))
      try {
        out = await runTool(call.name, a)
      } catch (e) {
        before.forEach((f, i) => (frames[i] = f))
        const msg = e instanceof Error ? e.message : String(e)
        console.error(`[story-agent] tool ${call.name} failed:`, msg)
        out =
          msg === "openai_missing"
            ? "FAILED: changing a designed frame needs her OpenAI key, which isn't connected (Settings → חיבורים). Tell her."
            : `FAILED: ${msg.slice(0, 300)}`
      }
      results.push({ type: "tool_result", tool_use_id: call.id, content: typeof out === "string" ? out : (out as Anthropic.ToolResultBlockParam["content"]) } as Block)
    }
    if (ending === "finish") return finishRun(finishReply)
    if (ending) return ending
    if (Date.now() - started > THINK_BUDGET_MS) results.push({ type: "text", text: "Time is nearly up: finish now, saying plainly what the last drafts show." })
    messages.push({ role: "user", content: results })
  }
  return finishRun(anyDirty() ? "עשיתי את השינויים, הגרסה החדשה כבר בכרטיס." : "לא הספקתי לסיים הפעם. נסו לכתוב שוב, אולי בבקשה אחת בכל פעם.")

  function anyDirty(): boolean {
    return frames.some((f) => f.dirty)
  }

  /** 1-based frame numbers → valid 0-based indexes (all frames when none given and `all`). */
  function pick(raw: unknown, all = false): number[] {
    const list = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw]
    const idx = [...new Set(list.map((n) => Number(n) - 1).filter((n) => Number.isInteger(n) && n >= 0 && n < total))]
    return idx.length || !all ? idx : frames.map((_, i) => i)
  }


  /** The designed frame as it stands now, as bytes. */
  async function designedBytes(i: number): Promise<Buffer> {
    const f = frames[i]
    if (f.draftPng) return f.draftPng
    return Buffer.from((await loadImageForModels(f.url)).base64, "base64")
  }

  function captionSpec(i: number): CaptionSpec {
    const f = frames[i]
    const unit = scriptOf(i)
    return {
      // The words are the script's (MEDIA TEXT IS THE SCRIPT), else what's on it.
      headline: unit ? unit.headline : f.spec?.headline,
      body: unit ? unit.body : f.spec?.body,
      position: f.spec?.position ?? "bottom",
      style: { ...look, ...(f.spec?.style ?? {}) },
      ...(f.spec?.design ? { design: f.spec.design } : {}),
    }
  }

  /** Draw an own frame's caption as a draft, and take its look. */
  async function draftOwn(i: number): Promise<string | null> {
    const f = frames[i]
    const spec = captionSpec(i)
    const source = f.source!
    if (!spec.headline && !spec.body) {
      // No script text for this frame: her file as it is.
      f.draftUrl = f.media === "image" ? source : undefined
      f.videoDraft = undefined
      f.look = (await stillOf(source, f.media)) ?? undefined
      f.dirty = f.url !== source
      return "the script has no text for this frame, so it carries no caption"
    }
    if (drafts >= MAX_DRAFTS) return "FAILED: no more drafts this turn — finish, saying plainly what the last drafts show"
    drafts++
    if (f.media === "video") {
      const animated = !!spec.design
      const p = await input.call<{ preview?: string; template?: string; message?: string; error?: string }>("/api/story/generate-video-media", {
        postId,
        format: "story",
        sourceUrl: source,
        persist: false,
        caption: spec,
        preview: true,
        ...(animated ? { animated: true } : {}),
      })
      if (!p.ok || !p.data.preview) return `FAILED to draw the caption on frame ${i + 1}: ${p.data.message ?? p.data.error ?? "unknown"}`
      f.videoDraft = { spec, source, template: p.data.template, animated }
      f.draftUrl = undefined
      f.look = p.data.preview
    } else {
      const r = await input.call<{ url?: string; message?: string; error?: string }>("/api/media/caption-image", {
        postId,
        format: "story",
        sourceUrl: source,
        persist: false,
        store: true,
        force: true,
        caption: spec,
      })
      if (!r.ok || !r.data.url) return `FAILED to draw the caption on frame ${i + 1}: ${r.data.message ?? r.data.error ?? "unknown"}`
      f.draftUrl = r.data.url
      f.videoDraft = undefined
      f.look = (await stillOf(r.data.url, "image")) ?? undefined
    }
    f.spec = spec
    f.dirty = true
    return null
  }

  async function runTool(name: string, a: Record<string, unknown>): Promise<string | Block[]> {
    switch (name) {
      case "look_at_frames": {
        await input.setProgress("מסתכל על הטיוטה...")
        return stillBlocks(pick(a.frames, true), "The frames as they stand:")
      }

      case "edit_design": {
        const idx = pick(a.frames)
        const instruction = String(a.instruction ?? "").trim()
        if (!idx.length || !instruction) return "FAILED: name the frames and the instruction."
        const wrong = idx.filter((i) => frames[i].kind !== "designed")
        if (wrong.length === idx.length) {
          return `REFUSED: frame${wrong.length > 1 ? "s" : ""} ${wrong.map((i) => i + 1).join(", ")} ${wrong.length > 1 ? "are" : "is"} not designed (her own media / locked). On her own frames only the caption changes (set_caption).`
        }
        const go = idx.filter((i) => frames[i].kind === "designed")
        await input.setProgress(go.length > 1 ? "משנה את העיצוב בפריימים..." : `משנה את העיצוב בפריים ${go[0] + 1}...`)
        const notes: string[] = []
        await Promise.all(
          go.map(async (i) => {
            const before = await designedBytes(i)
            const out = Buffer.from(cropStoryToCanvas(await editImage(openai(), editPrompt(instruction, 0) + wordsRule(i), await asModel(before), "9:16")), "base64")
            // Low on purpose: recolouring one small word moves a handful of cells; the agent looks at the draft anyway.
            if ((await changedShare(before, out)) < 0.0008) {
              notes.push(`Frame ${i + 1}: came back unchanged — nothing applied there.`)
              return
            }
            frames[i].draftPng = out
            frames[i].look = undefined
            frames[i].dirty = true
          }),
        )
        const done = go.filter((i) => frames[i].dirty)
        return [
          ...(wrong.length ? [{ type: "text", text: `Skipped (not designed): ${wrong.map((i) => i + 1).join(", ")}.` } as Block] : []),
          ...notes.map((n) => ({ type: "text", text: n }) as Block),
          ...(done.length ? await stillBlocks(done, `Draft after the change. ${CHECK}`) : []),
        ]
      }

      case "blend_picture": {
        const [i] = pick(a.frame)
        const pic = input.attached[Number(a.attached) - 1]
        if (i === undefined) return "FAILED: no such frame."
        if (!pic) return `FAILED: there is no attached picture ${a.attached} in this message (she attached ${input.attached.length}). Ask her to attach it.`
        if (frames[i].kind !== "designed") return `REFUSED: frame ${i + 1} is not a designed frame — her own media is never repainted. Offer use_as_is (her picture as the frame).`
        if (!input.canBlend) return "REFUSED: blending isn't available on this account. Offer use_as_is."
        await input.setProgress(`משלב את התמונה שלך בפריים ${i + 1}...`)
        const her = await normaliseImage(referenceBuffer(pic))
        const before = await designedBytes(i)
        const out = cropStoryToCanvas(await editImage(openai(), editPrompt(String(a.how ?? ""), 1) + wordsRule(i), await asModel(before), "9:16", [her]))
        const png = Buffer.from(out, "base64")
        if ((await changedShare(before, png)) < 0.03) return "FAILED: the frame came back unchanged — her picture didn't go in. Nothing was applied."
        if ((await picturesPlaced(anthropicKey, [her], out)) === false) {
          return "FAILED: the result doesn't show her subject recognisably (it came out as someone / something else). Nothing was applied. Try again with a clearer placement, or offer use_as_is."
        }
        frames[i].draftPng = png
        frames[i].look = undefined
        frames[i].dirty = true
        return stillBlocks([i], `Draft with her picture worked in. ${CHECK}`)
      }

      case "redraw_frame": {
        const idx = pick(a.frames)
        if (!idx.length) return "FAILED: name the frames."
        const go = idx.filter((i) => frames[i].kind === "designed")
        if (!go.length) return "REFUSED: those frames are her own media — never replaced by a drawn one here. A designed story is made from the media panel (השפה הויזואלית שלך)."
        const missing = go.filter((i) => !designedTexts[i])
        if (missing.length) return `FAILED: the script has no text for frame${missing.length > 1 ? "s" : ""} ${missing.map((i) => i + 1).join(", ")}.`
        await input.setProgress(go.length > 1 ? "מצייר את הפריימים מחדש בשפה הוויזואלית שלך..." : `מצייר את פריים ${go[0] + 1} מחדש בשפה הוויזואלית שלך...`)
        const steer = typeof a.direction === "string" && a.direction.trim() ? a.direction.trim() : undefined
        const direction = withMediaBrief(withGraphicOnly(await resolveDesignDirection(db, userId, { format: "story" }), input.email), steer)
        const composition = pickComposition(Math.floor(Math.random() * 1000))
        await Promise.all(
          go.map(async (i) => {
            const raw = await generateImage(openai(), buildStoryPrompt(designedTexts[i], i, total, direction, composition, ""), {
              shape: "9:16",
              quality: "high",
              references: direction.references,
            })
            const done = await applyFixedElements(cropStoryToCanvas(raw), direction.fixed, frameRole(i, total))
            frames[i].draftPng = Buffer.from(done, "base64")
            frames[i].look = undefined
            frames[i].dirty = true
          }),
        )
        return stillBlocks(go, `Drawn again in her visual language (draft). ${CHECK}`)
      }

      case "set_caption": {
        const idx = pick(a.frames, true)
        const go = idx.filter((i) => frames[i].kind === "own")
        if (!go.length) return "REFUSED: none of those frames is her own media. On a designed frame the words are part of the picture — use edit_design."
        const position = a.position === "top" || a.position === "center" || a.position === "bottom" ? a.position : undefined
        const move = typeof a.move_y === "number" && Number.isFinite(a.move_y) ? a.move_y : 0
        const design = typeof a.design === "string" && a.design.trim() ? a.design.trim() : undefined
        await input.setProgress(go.length > 1 ? "מעדכן את הכיתוב בפריימים..." : `מעדכן את הכיתוב בפריים ${go[0] + 1}...`)
        const notes: string[] = []
        for (const i of go) {
          const f = frames[i]
          const prev = f.spec ?? {}
          const baseOffset = position ? 0 : (prev.style?.offsetY ?? 0)
          const style = cleanCaptionStyle({ text: a.text, pill: a.pill, scale: a.scale, ...(move || position ? { offsetY: baseOffset + move } : {}) })
          const before = { spec: f.spec, draftUrl: f.draftUrl, videoDraft: f.videoDraft, look: f.look, dirty: f.dirty }
          f.spec = {
            ...prev,
            ...(position ? { position } : {}),
            ...(style ? { style: { ...(prev.style ?? {}), ...style } } : {}),
            ...(design && f.media === "video" ? { design } : {}),
          }
          const err = await draftOwn(i)
          if (err?.startsWith("FAILED")) {
            Object.assign(f, before)
            notes.push(err)
          } else if (err) notes.push(`Frame ${i + 1}: ${err}.`)
          if (design && f.media === "image") notes.push(`Frame ${i + 1} is a PHOTO: \`design\` doesn't apply to it (position, move, colours, box and size do).`)
        }
        const shown = go.filter((i) => frames[i].dirty)
        return [
          ...notes.map((n) => ({ type: "text", text: n }) as Block),
          ...(shown.length ? await stillBlocks(shown, `Draft of the caption (${JSON.stringify(shown.map((i) => ({ frame: i + 1, position: frames[i].spec?.position, style: frames[i].spec?.style ?? null })))}). ${CHECK}`) : []),
        ]
      }

      case "use_as_is": {
        const [i] = pick(a.frame)
        const n = Number(a.attached) - 1
        const pic = input.attached[n]
        if (i === undefined) return "FAILED: no such frame."
        if (!pic) return `FAILED: there is no attached picture ${a.attached} in this message (she attached ${input.attached.length}). Ask her to attach it (the image button: from her computer or Google Drive).`
        await input.setProgress(`שם את המדיה שלך בפריים ${i + 1}...`)
        const video = input.attachedVideos?.[n] ?? null
        let source: string
        if (video) {
          source = video.startsWith("drive:") ? `https://drive.google.com/file/d/${video.slice(6)}/view` : input.publicUrl(video.slice(8))
        } else {
          // Her file, stored among her own media (image/), so it is always known as hers.
          const jpg = await sharp(referenceBuffer(pic)).rotate().jpeg({ quality: 92 }).toBuffer()
          const path = `${userId}/image/own-${crypto.randomUUID()}.jpg`
          const { error } = await db.storage.from("user-media").upload(path, jpg, { contentType: "image/jpeg" })
          if (error) return `FAILED: couldn't store her picture (${error.message}).`
          source = input.publicUrl(path)
        }
        const f = frames[i]
        const before = { ...f }
        Object.assign(f, {
          kind: "own" as const,
          media: video ? ("video" as const) : ("image" as const),
          source,
          // The look carries over from her own frame; a designed frame starts on the default.
          spec: before.kind === "own" ? { position: before.spec?.position, style: before.spec?.style } : undefined,
          draftPng: undefined,
          draftUrl: undefined,
          videoDraft: undefined,
          look: undefined,
          lockedWhy: undefined,
        })
        const err = await draftOwn(i)
        if (err?.startsWith("FAILED")) {
          Object.assign(f, before)
          return err
        }
        f.dirty = true
        return [
          ...(err ? [{ type: "text", text: `Frame ${i + 1}: ${err}.` } as Block] : []),
          ...(await stillBlocks([i], `Her ${video ? "video" : "photo"} is frame ${i + 1} now, as it is, with the script's words over it (draft). It is HER OWN frame from here: only its caption changes (set_caption). ${CHECK}`)),
        ]
      }

      case "remember": {
        await input.setProgress("שומר את ההעדפה שלך...")
        const what = String(a.what ?? "").trim()
        if (!what) return "FAILED: nothing to remember."
        const r = await triageVisualMemory(db, userId, anthropicKey, {
          instruction: a.scope === "all" ? `${what}\n(for all my formats)` : what,
          format: "story",
          explicit: true,
        })
        const m = r.memory
        if (m.kind === "saved") {
          remembered = true
          return `SAVED to her preferences [${m.scope}]: "${m.summary}". Tell her it's saved and shows in Settings → מדיה → העדפות ויזואליות.`
        }
        if (m.kind === "conflict")
          return `NOT SAVED — it goes against saved preferences: ${m.previous.map((p) => `[id ${p.id}] "${p.summary}"`).join("; ")}. Proposal: rule=${JSON.stringify(m.proposal.rule)}, summary_he=${JSON.stringify(m.proposal.summary_he)}, scope=${m.proposal.scope}. ask_user whether to replace the old one(s) with it; if she says yes, call replace_preferences with these ids and this proposal.`
        if (m.kind === "settings")
          return `NOT SAVED — it's about ${m.topics.join("/")} (${m.summary}), which live in her Settings → מדיה → שפה ויזואלית, not in preferences. Tell her to set it there.`
        return "NOT SAVED — nothing lasting about how things look was found in it. Describe the preference more concretely and try again, or tell her what's missing."
      }

      case "replace_preferences": {
        const ids = Array.isArray(a.replace_ids) ? (a.replace_ids as unknown[]).map(String) : []
        const scope = isRuleScope(a.scope) ? a.scope : "story"
        if (!ids.length) return "FAILED: no ids."
        const rule = await replaceStyleRules(db, userId, ids, { rule: String(a.rule ?? ""), summary_he: String(a.summary_he ?? ""), scope })
        return `SAVED (replaced the old ones): "${rule.summary_he}".`
      }
    }
    return `Unknown tool ${name}.`
  }

  async function finishRun(reply: string): Promise<BRollAgentOutcome> {
    if (!anyDirty()) return { kind: "done", reply: reply || "לא שיניתי כלום.", url: input.urls[0], urls: input.urls, changed: false }
    await input.setProgress("שומר את הסטורי...")
    // Offered only for a change on a designed frame: her preferences shape what we draw.
    const offerNow = offer && !remembered && frames.some((f) => f.dirty && f.kind === "designed") ? offer : undefined
    const next: string[] = []
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i]
      if (!f.dirty) {
        next.push(f.url)
        continue
      }
      if (f.videoDraft) {
        // The checked draft becomes the clip — burned once, now.
        await input.setProgress(`צורב את הכיתוב בסרטון של פריים ${i + 1}... זה לוקח כדקה`)
        const r = await input.call<{ url?: string; message?: string; error?: string }>("/api/story/generate-video-media", {
          postId,
          format: "story",
          sourceUrl: f.videoDraft.source,
          persist: false,
          caption: f.videoDraft.spec,
          ...(f.videoDraft.animated ? { animated: true } : {}),
          ...(f.videoDraft.template ? { template: f.videoDraft.template } : {}),
        })
        if (!r.ok || !r.data.url) {
          return { kind: "failed", reply: r.data.message ?? `הטמעת הכיתוב בסרטון של פריים ${i + 1} לא הצליחה הפעם, אז הסטורי נשאר כמו שהיה. נסו שוב.` }
        }
        next.push(r.data.url)
      } else if (f.draftPng) {
        const path = `${userId}/story/${crypto.randomUUID()}.png`
        const { error } = await db.storage.from("user-media").upload(path, f.draftPng, { contentType: "image/png" })
        if (error) return { kind: "failed", reply: "השמירה של הפריים החדש לא הצליחה, אז הסטורי נשאר כמו שהיה. נסו שוב." }
        next.push(input.publicUrl(path))
      } else if (f.draftUrl) {
        next.push(f.draftUrl)
      } else {
        next.push(f.source ?? f.url)
      }
    }
    const saved = await input.call<{ urls?: string[]; message?: string }>("/api/media/own-edit", {
      action: "save",
      postId,
      format: "story",
      urls: next,
    })
    if (!saved.ok) return { kind: "failed", reply: saved.data.message ?? "השינוי לא נשמר, והסטורי נשאר כמו שהיה. נסו שוב." }
    return { kind: "done", reply: reply || "עדכנתי את הסטורי.", url: next[0], urls: next, changed: true, ...(offerNow ? { rememberOffer: offerNow } : {}) }
  }
}
