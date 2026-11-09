import Anthropic from "@anthropic-ai/sdk"
import type { SupabaseClient } from "@supabase/supabase-js"
import { finalizeHtml, reviseBRoll, type CompositionBrief } from "@/lib/broll-animation/compose"
import { renderComposition } from "@/lib/broll-animation/render"
import { hasOwnBackground, saveBRoll, uploadBackground, type StoredComposition } from "@/lib/broll-animation/store"
import { currentCompositionBrief } from "@/lib/broll-animation/brief"
import {
  BACKGROUND_FRAMINGS,
  buildBackgroundPrompt,
  cropToCanvas,
  OWN_BACKGROUND_LINE,
  pictureAsBackground,
} from "@/lib/broll-animation/background"
import { editImage, generateImage } from "@/lib/openai-image"
import { MOTION_RESTYLE_NOTE, MOTION_RESTYLE_NOTE_OWN_PICTURE } from "@/lib/visual-language/current-brief"
import { referenceBuffer } from "@/lib/ai-edit-references"
import { changedArea, editPrompt } from "@/lib/ai-edit-plan"
import { loadImageForModels, normaliseImage } from "@/lib/visual-language/image-input"
import { picturesPlaced } from "@/lib/placed-check"
import { snapshotComposition } from "@/lib/edit-agent/snapshot"
import type { ScriptText } from "@/lib/script-text"

/**
 * The AI edit chat for a b-roll, as an AGENT (Hani, 2026-11-10): it sees the
 * clip, the whole conversation and her visual language; it works in steps
 * through tools that are today's b-roll operations; it LOOKS at its draft
 * before answering and fixes what's off; it asks when there is more than one
 * right answer; and its reply says what really happened — including why
 * something didn't work.
 *
 * Runs on the server (api/edit-agent), so a reload never loses it.
 *
 * IRON RULE: only a b-roll WE made (an engine composition) — never her own
 * media from Google Drive / her computer. The route refuses before this runs;
 * nothing here can reach her own clip.
 */

export const AGENT_MODEL = "claude-opus-5-5"

/** Leave the full render (~4–5 min on our functions) its time inside the 800s cap. */
const THINK_BUDGET_MS = 380_000
const MAX_STEPS = 10
const LOOK_TIMES = [0.9, 2.6, 6.4]

export interface ChatTurn {
  role: "user" | "assistant"
  text: string
  /** How many pictures she attached to that message. */
  images?: number
}

export interface BRollAgentInput {
  db: SupabaseClient
  userId: string
  postId: string
  anthropicKey: string
  openaiKey: string | null
  canBlend: boolean
  clipUrl: string
  composition: StoredComposition
  /** The script's words for the clip — the ONLY words on it. */
  script: ScriptText | null
  /** The conversation so far, oldest first (without this message). */
  history: ChatTurn[]
  request: string
  /** Pictures she attached to THIS message (data URLs). */
  attached: string[]
  setProgress: (text: string) => Promise<void>
}

export type BRollAgentOutcome =
  | { kind: "done"; reply: string; url: string; changed: boolean }
  | { kind: "ask"; question: string; options: { label: string; action: string }[] }
  | { kind: "failed"; reply: string }

const squash = (t: string) =>
  t.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, "").replace(/[\s"'`״׳.,!?:;—–\-\[\]()+]+/g, "")
function hasScriptWords(template: string, text: ScriptText): boolean {
  const page = squash(template)
  return [text.headline, text.body].every((t) => !t || page.includes(squash(t)))
}
function scriptWordsFix(text: ScriptText): string {
  return [
    "Change ONLY the words on screen, keep the design, layout, colours and motion exactly as they are.",
    "The words must be EXACTLY these (Hebrew, RTL), word for word, nothing added, nothing left out, no other text (no CTA, no title):",
    ...(text.headline ? [`- Main line: ${JSON.stringify(text.headline)}`] : []),
    ...(text.body ? [`- Then: ${JSON.stringify(text.body)}`] : []),
  ].join("\n")
}

function blendPrompt(edit: string): string {
  return [
    "Edit the FIRST input image (the background of an animated social video — it has no text). The second input image is the creator's own picture. Work its subject INTO this scene:",
    edit,
    "",
    "Blend it into the scene: same lighting, colour grade, palette, grain and style as the first image, so it looks designed together with it. The subject stays recognisably the SAME — the same person (face, hair, features), character, product or logo, with the same details — never a different or re-imagined one.",
    "Keep everything else of the first image as it is. No text, letters or numbers. No person, character, animal or object that isn't in either input. Nothing touches or crosses the image edge.",
  ].join("\n")
}

const SYSTEM = `You are the AI edit chat of a content app, working on ONE b-roll: a 7-second vertical (1080×1920) animated clip = a background PICTURE (a still image, no text) + an HTML/GSAP text animation over it, in the creator's visual language. The creator writes in Hebrew.

You talk with her like a sharp, warm designer colleague: you understand what she means, infer the unstated from context and from the whole conversation, remember what was said and done, and can explain why something did or didn't work. When she asks a question or wants to talk it through, just answer (finish) — not every message is an edit.

How you work:
- You see the clip as stills (from its start, middle and end). Look before you change things when the stills don't tell you enough, and ALWAYS look at your draft after changing it, before finish — if it doesn't match what she asked, fix it (another step), then look again.
- No invented people: never add a face, person or figure on your own (Hani's rule). A person appears only when she attaches her own picture (blend_picture / picture_as_background). If she asks for a person without a picture, ask her to attach one.
- Tools change a DRAFT. Nothing is rendered or saved until you finish; then the draft is rendered (~4 minutes) and becomes her b-roll. If you changed nothing, nothing is rendered.
- The words on the clip are the post's script, word for word — never invent, add, translate or drop words (no titles, no CTA). You may change how they look and move, not what they say.
- The background picture: change_background edits it; new_background draws a new one in her visual language; blend_picture works a picture she attached into it; picture_as_background uses her attached picture as the background exactly as it is (only when she says so, e.g. "כמו שהיא"). If the background is HER OWN picture (stated below), it is never repainted or replaced by a drawn one — say so if she asks.
- restyle_to_visual_language rebuilds the look in her CURRENT visual language (background + text design) — when she asks for "השפה שלי" / to match her brand.
- When her request has more than one reasonable reading, or would cost a long render on a guess, ask_user with 2–4 short options (Hebrew). Don't ask when the answer is clear.
- Tool results tell you when a step failed and why. Never claim something happened that didn't.

finish.reply: Hebrew, plural forms (אתם / נסו), 1–3 short sentences, natural spoken Hebrew. Say what you actually did and what she'll see; if something didn't work, say plainly what and why, and what she can do. She reads your reply only after the render is done and the new version is already on her card — so never say it will appear later; say what's on the card now. No emojis, no markdown.`

const TOOLS: Anthropic.Tool[] = [
  {
    name: "look_at_draft",
    description: "See the current draft as stills (start, middle, end). Use after every change before finish.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "change_design",
    description:
      "Change the TEXT animation / layout / typography / colours / motion / timing / sizes (not the background picture). Instruction in English or Hebrew, precise: what to change and what to keep.",
    input_schema: { type: "object", properties: { instruction: { type: "string" } }, required: ["instruction"] },
  },
  {
    name: "change_background",
    description: "Edit the background PICTURE in place (add/remove/change things in the scene, colours, light). Not allowed when the background is her own picture.",
    input_schema: { type: "object", properties: { instruction: { type: "string", description: "English, what to change in the picture." } }, required: ["instruction"] },
  },
  {
    name: "new_background",
    description: "Draw a brand-new background picture in her visual language (optionally steered). Not allowed when the background is her own picture.",
    input_schema: { type: "object", properties: { direction: { type: "string", description: "Optional English steer for the scene." } } },
  },
  {
    name: "blend_picture",
    description: "Work a picture she attached to THIS message into the background scene, in its look (her subject stays recognisably the same).",
    input_schema: {
      type: "object",
      properties: { attached: { type: "integer", minimum: 1 }, how: { type: "string", description: "English: where/how it goes in the scene." } },
      required: ["attached", "how"],
    },
  },
  {
    name: "picture_as_background",
    description: "Use a picture she attached to THIS message as the background exactly as it is (only when she asked for it as is).",
    input_schema: { type: "object", properties: { attached: { type: "integer", minimum: 1 } }, required: ["attached"] },
  },
  {
    name: "restyle_to_visual_language",
    description: "Rebuild the look in her CURRENT visual language: new background (unless it's her own picture) + text design.",
    input_schema: { type: "object", properties: {} },
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
    input_schema: { type: "object", properties: { reply: { type: "string" } }, required: ["reply"] },
  },
]

type Block = Anthropic.ContentBlockParam
const jpeg = (b64: string): Block => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } })
function dataUrlBlock(url: string): Block {
  const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/.exec(url)
  if (!m) return { type: "text", text: "(an image that couldn't be read)" }
  return { type: "image", source: { type: "base64", media_type: m[1] as "image/png", data: m[2] } }
}

export async function runBRollAgent(input: BRollAgentInput): Promise<BRollAgentOutcome> {
  const { db, userId, postId, anthropicKey, openaiKey, composition, script } = input
  const started = Date.now()
  const client = new Anthropic({ apiKey: anthropicKey })

  // The draft — what the tools change. Nothing is saved until finish.
  let brief: CompositionBrief = script
    ? { ...composition.brief, hook: script.headline ?? script.body ?? composition.brief.hook, rest: script.headline ? script.body : undefined, cta: null }
    : composition.brief
  let template = composition.template
  let backgroundUrl = composition.backgroundUrl
  let ownBackground = hasOwnBackground(composition)
  let changed = false
  const done: string[] = []
  const stamp = () => crypto.randomUUID()
  const draftHtml = () => finalizeHtml(template, backgroundUrl, brief.fonts)

  const { direction } = await currentCompositionBrief(db, userId, composition.brief, { format: "b_roll" })

  await input.setProgress("מסתכל על הבי-רול...")
  const stills = await snapshotComposition(draftHtml(), LOOK_TIMES).catch(() => [] as string[])

  const transcript = input.history.length
    ? input.history
        .map((t) => `${t.role === "user" ? "HER" : "YOU"}: ${t.text}${t.images ? ` [attached ${t.images} picture${t.images > 1 ? "s" : ""}]` : ""}`)
        .join("\n")
    : "(this is the first message)"

  const state = [
    "THE CLIP NOW:",
    `- Words on it (the script — exactly these): ${JSON.stringify([script?.headline ?? brief.hook, script ? script.body : brief.rest].filter(Boolean).join(" / "))}`,
    `- Background: ${ownBackground ? "HER OWN picture (never repaint or replace it with a drawn one)" : "a picture we drew in her visual language"}`,
    `- Edits applied so far (oldest first): ${composition.edits.length ? composition.edits.map((e) => JSON.stringify(e)).join("; ") : "none"}`,
    "",
    "HER VISUAL LANGUAGE (and her saved preferences):",
    ...direction.lines.slice(0, 40).map((l) => `- ${l}`),
    "",
    "THE CONVERSATION SO FAR:",
    transcript,
  ].join("\n")

  const first: Block[] = [
    { type: "text", text: state },
    ...(stills.length ? [{ type: "text", text: "Stills of the clip now (start, middle, end):" } as Block, ...stills.map(jpeg)] : []),
    ...input.attached.flatMap((a, i): Block[] => [{ type: "text", text: `Attached picture ${i + 1} (with this message):` }, dataUrlBlock(a)]),
    { type: "text", text: `HER MESSAGE NOW:\n${input.request}` },
  ]
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: first }]

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
      return finishRun(said || (changed ? "עשיתי את השינויים." : "לא הצלחתי להבין מה לעשות. אפשר לנסח שוב?"))
    }

    const results: Block[] = []
    for (const call of calls) {
      const a = (call.input ?? {}) as Record<string, unknown>
      if (call.name === "finish") {
        const reply = String(a.reply ?? "").trim() || "סיימתי."
        return finishRun(reply)
      }
      if (call.name === "ask_user") {
        const options = Array.isArray(a.options)
          ? (a.options as { label?: unknown; action?: unknown }[])
              .map((o) => ({ label: String(o.label ?? "").trim(), action: String(o.action ?? o.label ?? "").trim() }))
              .filter((o) => o.label)
              .slice(0, 4)
          : []
        return { kind: "ask", question: String(a.question ?? "").trim(), options }
      }
      let out: string | Block[]
      try {
        out = await runTool(call.name, a)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        out =
          msg === "openai_missing"
            ? "FAILED: changing the picture needs her OpenAI key, which isn't connected (Settings). Tell her."
            : `FAILED: ${msg.slice(0, 300)}`
      }
      results.push({ type: "tool_result", tool_use_id: call.id, content: typeof out === "string" ? out : (out as Anthropic.ToolResultBlockParam["content"]) } as Block)
    }
    if (Date.now() - started > THINK_BUDGET_MS) {
      results.push({ type: "text", text: "Time is nearly up: finish now (the render still needs its minutes)." })
    }
    messages.push({ role: "user", content: results })
  }
  return finishRun(changed ? "עשיתי את השינויים, הגרסה החדשה כבר בכרטיס." : "לא הספקתי לסיים הפעם. נסו לכתוב שוב, אולי בבקשה אחת בכל פעם.")

  async function runTool(name: string, a: Record<string, unknown>): Promise<string | Block[]> {
    switch (name) {
      case "look_at_draft": {
        await input.setProgress("מצלם את הטיוטה כדי לבדוק אותה...")
        const shots = await snapshotComposition(draftHtml(), LOOK_TIMES)
        return [{ type: "text", text: "The draft now (start, middle, end):" }, ...shots.map(jpeg)] as Block[]
      }
      case "change_design": {
        await input.setProgress("משנה את העיצוב של הטקסט...")
        const next = await reviseBRoll(anthropicKey, brief, template, String(a.instruction ?? ""), input.attached)
        if (next.trim() === template.trim()) return "No change came back — the design is the same. Try a more specific instruction, or tell her."
        template = next
        changed = true
        done.push("design")
        return "Done (draft). Look at it before finish."
      }
      case "change_background": {
        if (ownBackground) return "REFUSED: the background is her own picture — it is never repainted. Tell her, and offer what you can do."
        await input.setProgress("משנה את התמונה ברקע...")
        const source = await loadImageForModels(backgroundUrl)
        const out = cropToCanvas(await editImage(openai(), editPrompt(String(a.instruction ?? ""), 0), source, "9:16"))
        if ((await changedArea(backgroundUrl, out)) < 0.03) return "FAILED: the picture came back (almost) unchanged. Nothing was applied."
        backgroundUrl = await uploadBackground(db, userId, stamp(), Buffer.from(out, "base64"))
        changed = true
        done.push("background edit")
        return "Done (draft). Look at it before finish."
      }
      case "new_background": {
        if (ownBackground) return "REFUSED: the background is her own picture — it is never replaced by a drawn one. Tell her."
        await input.setProgress("מצייר רקע חדש בשפה הוויזואלית שלך...")
        const context = [brief.hook, brief.rest, typeof a.direction === "string" ? a.direction : ""].filter(Boolean).join("\n")
        const raw = await generateImage(openai(), buildBackgroundPrompt(direction, BACKGROUND_FRAMINGS[0], context), { shape: "9:16" })
        backgroundUrl = await uploadBackground(db, userId, stamp(), Buffer.from(cropToCanvas(raw), "base64"))
        changed = true
        done.push("new background")
        return "Done (draft). Look at it before finish."
      }
      case "blend_picture": {
        const pic = input.attached[Number(a.attached) - 1]
        if (!pic) return `FAILED: there is no attached picture ${a.attached} in this message (she attached ${input.attached.length}).`
        if (ownBackground) return "REFUSED: the background is her own picture; blending would repaint it. Offer picture_as_background or a design change."
        if (!input.canBlend) return "REFUSED: blending isn't available on this account. Offer picture_as_background."
        await input.setProgress("משלב את התמונה שלך ברקע...")
        const her = await normaliseImage(referenceBuffer(pic))
        const source = await loadImageForModels(backgroundUrl)
        const out = cropToCanvas(await editImage(openai(), blendPrompt(String(a.how ?? "")), source, "9:16", [her]))
        if ((await changedArea(backgroundUrl, out)) < 0.03) return "FAILED: the scene came back unchanged — her picture didn't go in. Nothing was applied."
        if ((await picturesPlaced(anthropicKey, [her], out)) === false)
          return "FAILED: the result doesn't show her subject recognisably (it came out as someone/something else). Nothing was applied."
        backgroundUrl = await uploadBackground(db, userId, stamp(), Buffer.from(out, "base64"))
        changed = true
        done.push("blend")
        return "Done (draft). Look at it before finish."
      }
      case "picture_as_background": {
        const pic = input.attached[Number(a.attached) - 1]
        if (!pic) return `FAILED: there is no attached picture ${a.attached} in this message.`
        await input.setProgress("שם את התמונה שלך כרקע...")
        backgroundUrl = await uploadBackground(db, userId, stamp(), await pictureAsBackground(referenceBuffer(pic)))
        ownBackground = true
        brief = { ...brief, styleSpec: brief.styleSpec.includes(OWN_BACKGROUND_LINE) ? brief.styleSpec : `${brief.styleSpec}\n\n${OWN_BACKGROUND_LINE}` }
        template = await reviseBRoll(anthropicKey, brief, template, "The background is now the creator's own picture. Adjust only the text so it reads well over it.")
        changed = true
        done.push("own picture background")
        return "Done (draft): her picture is the background and the text was adjusted to read over it. Look before finish."
      }
      case "restyle_to_visual_language": {
        await input.setProgress("בונה מחדש בשפה הוויזואלית שלך...")
        const cur = await currentCompositionBrief(db, userId, composition.brief, { format: "b_roll", ownLanguage: true })
        brief = { ...cur.brief, hook: brief.hook, rest: brief.rest, cta: brief.cta, ...(ownBackground ? { styleSpec: `${cur.brief.styleSpec}\n\n${OWN_BACKGROUND_LINE}` } : {}) }
        if (!ownBackground) {
          const context = [brief.hook, brief.rest].filter(Boolean).join("\n")
          const raw = await generateImage(openai(), buildBackgroundPrompt(cur.direction, BACKGROUND_FRAMINGS[0], context), { shape: "9:16" })
          backgroundUrl = await uploadBackground(db, userId, stamp(), Buffer.from(cropToCanvas(raw), "base64"))
        }
        template = await reviseBRoll(anthropicKey, brief, template, ownBackground ? MOTION_RESTYLE_NOTE_OWN_PICTURE : MOTION_RESTYLE_NOTE)
        changed = true
        done.push("restyle")
        return "Done (draft). Look at it before finish."
      }
    }
    return `Unknown tool ${name}.`
  }

  async function finishRun(reply: string): Promise<BRollAgentOutcome> {
    if (!changed) return { kind: "done", reply, url: input.clipUrl, changed: false }
    // The words are the script's, whatever ran.
    if (script && !hasScriptWords(template, script)) {
      template = await reviseBRoll(anthropicKey, brief, template, scriptWordsFix(script))
    }
    await input.setProgress("מרנדר את הבי-רול החדש... זה לוקח כמה דקות")
    const os = await import("os")
    const fs = await import("fs/promises")
    const path = await import("path")
    const id = stamp()
    const outPath = path.join(os.tmpdir(), `broll-agent-${id}.mp4`)
    try {
      await renderComposition(draftHtml(), outPath)
      const clip = await fs.readFile(outPath)
      const url = await saveBRoll(db, userId, postId, id, clip, {
        ...composition,
        brief,
        backgroundUrl,
        template,
        edits: [...composition.edits, input.request],
        ...(ownBackground ? { ownBackground: true } : {}),
      })
      return { kind: "done", reply, url, changed: true }
    } finally {
      await fs.unlink(outPath).catch(() => undefined)
    }
  }
}
