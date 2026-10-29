import Anthropic from "@anthropic-ai/sdk"
import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Standing style preferences, across ALL formats (Hani, 2026-10-22).
 *
 * When she tells an AI edit how she wants an element to look — "the brush
 * strokes thin and in the brand yellow", "never a dark background" — that's
 * not about one image. It's how she wants her content to look. Before this it
 * applied to that one image and was forgotten; the next carousel or b-roll
 * drew the brush the old way.
 *
 * So every AI-edit instruction (and every 👎 note) is read once by Claude:
 * if it states a lasting preference, it's distilled into one English rule and
 * kept here. Every generator then gets the rules (via resolveDesignDirection,
 * and the b-roll's Opus brief). One-off content changes ("make slide 3's title
 * say X") are not remembered.
 *
 * Stored as a small JSON file next to her media, so no schema change:
 *   user-media/<userId>/style-memory.json → { rules: StyleRule[] }
 */

export interface StyleRule {
  /** English, for the generators. */
  rule: string
  /** Hebrew, shown back to her ("אזכור להבא: …"). */
  summary_he: string
  /** Where it came from — the format she was editing. */
  source: string
  at: string
}

const BUCKET = "user-media"
const MAX_RULES = 20
const path = (userId: string) => `${userId}/style-memory.json`

export async function loadStyleRules(supabase: SupabaseClient, userId: string): Promise<StyleRule[]> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path(userId))
  if (error || !data) return []
  try {
    const parsed = JSON.parse(await data.text()) as { rules?: StyleRule[] }
    return Array.isArray(parsed.rules) ? parsed.rules : []
  } catch {
    return []
  }
}

async function saveStyleRules(supabase: SupabaseClient, userId: string, rules: StyleRule[]): Promise<void> {
  const body = JSON.stringify({ rules })
  const opts = { contentType: "application/json", upsert: true }
  const { error } = await supabase.storage.from(BUCKET).upload(path(userId), body, opts)
  if (!error) return
  // No UPDATE policy on the bucket → replace by delete + insert.
  await supabase.storage.from(BUCKET).remove([path(userId)])
  const retry = await supabase.storage.from(BUCKET).upload(path(userId), body, { contentType: "application/json" })
  if (retry.error) throw new Error(retry.error.message)
}

/** Prompt lines for the generators; empty when she has none. */
export function styleRuleLines(rules: StyleRule[]): string[] {
  if (!rules.length) return []
  return [
    "STANDING PREFERENCES — the creator asked for these herself, in earlier edits. They override the general visual language wherever they apply:",
    ...rules.map((r) => `- ${r.rule}`),
  ]
}

/**
 * Read one instruction; if it carries a lasting preference, remember it.
 * Returns the Hebrew summary of what was remembered, or null. Never throws —
 * memory is a bonus on top of the edit, not a reason for it to fail.
 */
export async function learnFromInstruction(
  supabase: SupabaseClient,
  userId: string,
  anthropicKey: string,
  instruction: string,
  source: string,
): Promise<string | null> {
  try {
    const existing = await loadStyleRules(supabase, userId)
    const client = new Anthropic({ apiKey: anthropicKey })
    const msg = await client.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 600,
      system:
        "You maintain a creator's standing style preferences for her AI-designed social media (carousels, stories, image posts, animated b-roll). Reply with JSON only.",
      messages: [
        {
          role: "user",
          content: [
            `She just asked for this change while editing a ${source} (Hebrew): ${JSON.stringify(instruction)}`,
            "",
            "Current standing preferences:",
            existing.length ? existing.map((r, i) => `${i + 1}. ${r.rule}`).join("\n") : "(none)",
            "",
            "Does her request express a LASTING preference about how her designs should look — a specific element (brush strokes, icons, shapes, frames, arrows, highlights…), typography, colour use, layout habits, mood — that should apply to future designs in every format? One-off content edits (change this word, fix this slide's text, move this one thing on this image only) are NOT lasting.",
            "",
            'Return {"remember": false} or {"remember": true, "rule": "<one precise English rule a designer can follow>", "summary_he": "<short Hebrew summary for her>", "replaces": <number of an existing preference this updates, or null>}.',
          ].join("\n"),
        },
      ],
    })
    const text = msg.content.map((c) => (c.type === "text" ? c.text : "")).join("")
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as {
      remember?: boolean
      rule?: string
      summary_he?: string
      replaces?: number | null
    }
    if (!json.remember || !json.rule?.trim()) return null
    const rule: StyleRule = {
      rule: json.rule.trim(),
      summary_he: (json.summary_he ?? "").trim() || instruction,
      source,
      at: new Date().toISOString(),
    }
    const next = [...existing]
    const idx = typeof json.replaces === "number" ? json.replaces - 1 : -1
    if (idx >= 0 && idx < next.length) next[idx] = rule
    else next.push(rule)
    await saveStyleRules(supabase, userId, next.slice(-MAX_RULES))
    return rule.summary_he
  } catch (err) {
    console.error("[style-memory] learn failed", err)
    return null
  }
}
