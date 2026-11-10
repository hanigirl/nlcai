import Anthropic from "@anthropic-ai/sdk"
import { extractFirstJsonObject } from "@/lib/extract-first-json"

/**
 * The agent checks ITSELF before it answers (Hani, 2026-11-10: "תוסיף לסוכן
 * בדיקה שלו את עצמו אם עמד במשימה"). A second, fresh look — not the agent
 * grading its own work in the same breath: it gets only her request, the
 * media before, the draft after, the rules that must hold, and the reply the
 * agent is about to send. It answers whether the task was met, and what
 * isn't right. A miss goes back to the agent to fix; what can't be fixed has
 * to be said plainly in the reply.
 *
 * Returns null when the check itself couldn't run (model error, unreadable
 * answer) — then the run goes on as before; a broken check never blocks her.
 */

/** Same model as the agents (lib/edit-agent/broll-agent AGENT_MODEL). */
const CHECK_MODEL = "claude-opus-5-5"

export interface CheckShot {
  label: string
  /** JPEG, base64. */
  jpeg: string
}

export interface TaskCheckInput {
  apiKey: string
  /** What the media is, in one line ("an Instagram story of 3 frames", "a 7s b-roll"). */
  media: string
  /** Her message this turn. */
  request: string
  /** The conversation before it, for context ("like I said"). */
  conversation?: string
  before: CheckShot[]
  after: CheckShot[]
  /** What must hold whatever she asked (the script's words, her pixels…). */
  rules: string[]
  /** The reply the agent wants to send (Hebrew). */
  reply: string
}

export interface TaskCheck {
  met: boolean
  /** Each: what is wrong, concretely, and where. English. */
  issues: string[]
  /** Problems that were already there before this turn — hers to hear about, not this turn's miss. */
  preexisting: string[]
}

const SYSTEM = `You are the quality check of an AI design assistant. A creator asked for a change to her media; the assistant made a draft and wrote a reply. You get her request, the media BEFORE, the draft AFTER, the rules that must always hold, and the reply. Decide whether the draft really does what she asked — as she, a designer, would judge it by looking.

Check, in this order:
1. Every part of her request: is each one visibly done in AFTER, to the degree she asked ("a bit" is a bit, "100px" is about that much, "all frames" is all of them)? A part she asked for that isn't visible is a miss.
2. Nothing she didn't ask for changed in a way she would mind (text reworded, elements gone, layout broken, another frame altered).
3. The rules below hold in AFTER.
4. Looks right: no text cut off, overlapping, touching the edge or unreadable.
5. The reply is true: it claims nothing AFTER doesn't show, and it says so plainly when part of the request wasn't done.

Two things are NOT issues:
- A part of her request that isn't done but that the reply honestly reports as not done, with the reason. Leave it out of "issues"; if that is all that's missing, met is true.
- A problem that was ALREADY there in BEFORE and that this turn didn't cause or touch (a word of the script already missing, text already under the Instagram bars, an older layout flaw). Put it in "preexisting", not in "issues" — unless her request was to fix exactly that.

Be strict about what she asked and about broken results, and don't invent problems. Judge at the size she sees it — a phone screen: differences found only by comparing pixel by pixel (grain, texture, faint guide lines or background detail shifting slightly, a move of a few pixels) are not issues and need no mention. When the frames that should not change are identical to before, that is correct.

Answer with ONLY this JSON: {"met": true|false, "issues": ["what is wrong and where, concretely — one per issue"], "preexisting": ["a problem already there before, concretely — one per item"]} — "issues" empty when met; "preexisting" empty when there is none.`

const image = (b64: string): Anthropic.ContentBlockParam => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } })

export async function checkTask(input: TaskCheckInput): Promise<TaskCheck | null> {
  if (!input.after.length) return null
  try {
    const client = new Anthropic({ apiKey: input.apiKey })
    const shots = (lead: string, list: CheckShot[]): Anthropic.ContentBlockParam[] => [
      { type: "text", text: lead },
      ...list.flatMap((s): Anthropic.ContentBlockParam[] => [{ type: "text", text: `${s.label}:` }, image(s.jpeg)]),
    ]
    const res = await client.messages.create({
      model: CHECK_MODEL,
      max_tokens: 2000,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: `THE MEDIA: ${input.media}` },
            ...(input.conversation ? [{ type: "text" as const, text: `EARLIER IN THE CONVERSATION (context only):\n${input.conversation.slice(-4000)}` }] : []),
            { type: "text", text: `HER REQUEST NOW (Hebrew):\n${input.request}` },
            ...shots("BEFORE:", input.before),
            ...shots("AFTER (the draft):", input.after),
            { type: "text", text: `RULES THAT MUST HOLD:\n${input.rules.map((r) => `- ${r}`).join("\n")}` },
            { type: "text", text: `THE REPLY THE ASSISTANT WANTS TO SEND (Hebrew):\n${input.reply}` },
          ],
        },
      ],
    })
    const text = res.content.map((c) => (c.type === "text" ? c.text : "")).join("")
    const raw = extractFirstJsonObject(text)
    type Answer = { met?: unknown; issues?: unknown; preexisting?: unknown }
    const read = (): Answer | null => {
      try {
        return raw ? (JSON.parse(raw) as Answer) : null
      } catch {
        return null
      }
    }
    const parsed = read()
    if (!parsed) {
      console.error("[edit-agent self-check] unreadable answer:", text.slice(0, 400), `(stop: ${res.stop_reason})`)
      return null
    }
    const preexisting = Array.isArray(parsed.preexisting) ? parsed.preexisting.map((i) => String(i).trim()).filter(Boolean).slice(0, 4) : []
    const issues = Array.isArray(parsed.issues) ? parsed.issues.map((i) => String(i).trim()).filter(Boolean).slice(0, 6) : []
    if (typeof parsed.met !== "boolean") return null
    return { met: parsed.met && issues.length === 0, issues: parsed.met && !issues.length ? [] : issues.length ? issues : ["the request was not fully done"], preexisting }
  } catch (err) {
    console.error("[edit-agent self-check]", err instanceof Error ? err.message : err)
    return null
  }
}

/** What the agent is told when its draft didn't pass. */
export function checkFailedNote(check: TaskCheck, last: boolean): string {
  if (check.met) {
    // Passed, but something older is off: she should hear about it, once.
    return [
      "SELF-CHECK — your draft does what she asked. One more thing, already there BEFORE this turn (not your change):",
      ...check.preexisting.map((i) => `- ${i}`),
      "Don't fix it on your own. Finish now with the same reply plus one short sentence telling her about it and offering to fix it.",
    ].join("\n")
  }
  return [
    "SELF-CHECK — your draft does not fully do what she asked:",
    ...check.issues.map((i) => `- ${i}`),
    ...(check.preexisting.length ? ["Also, already there before this turn (don't fix on your own — tell her in one sentence and offer to):", ...check.preexisting.map((i) => `- ${i}`)] : []),
    last
      ? "This was the last check. Fix what you still can in one step, then finish; in the reply say plainly, per issue you couldn't fix, what isn't done and why — never claim it."
      : "Fix these with your tools (look at the result), then finish again. If an issue can't be fixed, finish and say plainly in the reply what isn't done and why — never claim it.",
  ].join("\n")
}
