import Anthropic from "@anthropic-ai/sdk"
import { createHash, randomUUID } from "crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { referenceBlocks } from "@/lib/ai-edit-references"
import { stripDashes } from "@/lib/strip-dashes"
import { loadBrandFonts } from "@/lib/broll-animation/brief"
import type { VisualFormat, VisualLanguage } from "@/lib/visual-language/types"
import {
  isRuleScope,
  type MemoryOutcome,
  type RuleScope,
  type SettingsTopic,
  type TriageResult,
  type VisualPreference,
} from "@/lib/visual-memory"

/**
 * Standing visual preferences — the memory of the AI-edit chat (Hani,
 * 2026-10-22; rules for what goes in it, 2026-11-05 — see lib/visual-memory).
 *
 * What lives here: how her designs move and behave — b-roll motion, how
 * elements enter, transitions, layout habits, a decoration the AI draws.
 * What never lives here: her brand colours, fonts and brand elements. Those
 * are Settings → שפה ויזואלית, and a request for a new one is sent there
 * instead of being saved (triageVisualMemory).
 *
 * Each preference has a scope — one format, or all of them — and every
 * generator gets the ones for its format (resolveDesignDirection →
 * styleRuleLines). She sees and edits them in Settings → העדפות ויזואליות.
 *
 * Stored as a small JSON file next to her media, so no schema change:
 *   user-media/<userId>/style-memory.json → { rules: StyleRule[] }
 * Rules saved before ids and scopes existed read as scope "all" with a
 * stable id derived from their content.
 */

export interface StyleRule {
  id: string
  /** English, for the generators. */
  rule: string
  /** Hebrew, shown to her (chat, settings tab). */
  summary_he: string
  scope: RuleScope
  /** The format she was editing when she asked (older rules: a noun). */
  source: string
  at: string
}

const BUCKET = "user-media"
const FILE = "style-memory.json"
const MAX_RULES = 40
const MODEL = "claude-opus-5-5"
const path = (userId: string) => `${userId}/${FILE}`

const FORMAT_NOUN: Record<VisualFormat, string> = {
  carousel: "carousel",
  story: "Instagram story",
  image_post: "single image post",
  b_roll: "animated b-roll reel",
}

function normalize(raw: Partial<StyleRule> & { rule?: string; at?: string }): StyleRule | null {
  if (!raw?.rule?.trim()) return null
  const at = raw.at ?? ""
  return {
    id: raw.id || `legacy-${createHash("sha1").update(`${at}|${raw.rule}`).digest("hex").slice(0, 12)}`,
    rule: raw.rule.trim(),
    summary_he: raw.summary_he?.trim() || raw.rule.trim(),
    scope: isRuleScope(raw.scope) ? raw.scope : "all",
    source: raw.source ?? "",
    at,
  }
}

function parseRules(text: string): StyleRule[] {
  const parsed = JSON.parse(text) as { rules?: unknown[] }
  return (Array.isArray(parsed.rules) ? parsed.rules : [])
    .map((r) => normalize(r as Partial<StyleRule>))
    .filter((r): r is StyleRule => r !== null)
}

/**
 * For the generators: never fails a generation. A missing file is simply no
 * preferences; anything else is logged and treated the same way.
 */
export async function loadStyleRules(supabase: SupabaseClient, userId: string): Promise<StyleRule[]> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path(userId))
  if (error || !data) return []
  try {
    return parseRules(await data.text())
  } catch (err) {
    console.error("[style-memory] unreadable file", err)
    return []
  }
}

/**
 * Before a write: a read that fails must stop the write, or saving one new
 * preference over an unread file would wipe all the others.
 */
async function loadForWrite(supabase: SupabaseClient, userId: string): Promise<StyleRule[]> {
  const { data: listed, error: listError } = await supabase.storage.from(BUCKET).list(userId, { search: FILE })
  if (listError) throw new Error(`style-memory list: ${listError.message}`)
  if (!listed?.some((f) => f.name === FILE)) return []
  const { data, error } = await supabase.storage.from(BUCKET).download(path(userId))
  if (error || !data) throw new Error(`style-memory read: ${error?.message ?? "empty"}`)
  return parseRules(await data.text())
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

/** Prompt lines for one format's generator; empty when none apply. */
export function styleRuleLines(rules: StyleRule[], format?: VisualFormat): string[] {
  const applicable = format ? rules.filter((r) => r.scope === "all" || r.scope === format) : rules
  if (!applicable.length) return []
  return [
    "STANDING PREFERENCES — the creator asked for these herself, in earlier edits. They override the general visual language wherever they apply, except her brand colours, fonts and brand elements, which always stay as set:",
    ...applicable.map((r) => `- ${r.rule}`),
  ]
}

export function toPreference(r: StyleRule): VisualPreference {
  return { id: r.id, summary_he: r.summary_he, scope: r.scope, at: r.at }
}

/** What her settings hold — the source of truth for colours, fonts and elements. */
async function loadSettingsSnapshot(supabase: SupabaseClient, userId: string) {
  const [{ data: row }, fonts] = await Promise.all([
    supabase.from("users").select("brand_colors, visual_language").eq("id", userId).single(),
    loadBrandFonts(supabase, userId).catch((err) => {
      console.error("[style-memory] fonts", err)
      return []
    }),
  ])
  const r = row as { brand_colors?: string[] | null; visual_language?: VisualLanguage | null } | null
  const vl = r?.visual_language
  const colors =
    vl?.status === "ok" && vl.palette?.length
      ? vl.palette.map((p) => `${p.hex} (${p.role})`)
      : (r?.brand_colors ?? [])
  return {
    colors,
    fonts: fonts.map((f) => `${f.family} (${f.role ?? "primary"})`),
    elements: (vl?.elements ?? []).map((e) => e.name).filter(Boolean),
  }
}

function parseJson<T>(msg: Anthropic.Message): T {
  const text = msg.content.map((c) => (c.type === "text" ? c.text : "")).join("")
  return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as T
}

const TRIAGE_SYSTEM =
  "You keep a creator's visual memory for her AI-designed social media (carousels, stories, image posts, animated b-roll) and decide what one chat message means for it. Her brand colours, fonts and brand elements belong to her settings only; everything else about how her designs look and move can be remembered. Reply with JSON only."

/**
 * One chat message, checked against her settings and saved preferences
 * (the rules: lib/visual-memory). Saves a new preference when that's the
 * answer; never saves over a contradiction or a settings clash.
 */
export async function triageVisualMemory(
  supabase: SupabaseClient,
  userId: string,
  anthropicKey: string,
  input: {
    instruction: string
    format: VisualFormat
    explicit?: boolean
    previousInstruction?: string
    refs?: string[]
  },
): Promise<TriageResult> {
  const [existing, settings] = await Promise.all([
    loadForWrite(supabase, userId),
    loadSettingsSnapshot(supabase, userId),
  ])
  const list = (xs: string[]) => (xs.length ? xs.join(", ") : "(none set)")
  const text = [
    `She is editing her ${FORMAT_NOUN[input.format]} in the AI-edit chat. Her message (Hebrew): ${JSON.stringify(input.instruction)}`,
    input.previousInstruction ? `Her previous request in this chat (Hebrew): ${JSON.stringify(input.previousInstruction)}` : "",
    input.explicit
      ? "She explicitly asked to SAVE this to her visual language — treat it as lasting unless it says nothing about how things look or move."
      : "",
    "",
    "HER SETTINGS (the only source for these three):",
    `- Brand colours: ${list(settings.colors)}`,
    `- Fonts: ${list(settings.fonts)}`,
    `- Brand elements (her uploaded logo / graphics): ${list(settings.elements)}`,
    "",
    "SAVED PREFERENCES (numbered, scope in brackets):",
    existing.length ? existing.map((r, i) => `${i + 1}. [${r.scope}] ${r.rule}`).join("\n") : "(none)",
    "",
    "Return JSON:",
    "{",
    '  "edit": true|false — does the message ask to change the media she is editing right now? false when it ONLY asks to remember / save / keep something, or only asks a question.',
    '  "edit_instruction": "<the change to make now, in her Hebrew words, without any remember / save wording; empty when edit is false>",',
    '  "lasting": true|false — does it say how her designs should look or move FROM NOW ON, beyond this one item? Words like remember, save, keep, always, from now on, every time make it lasting. "Save this" / "remember that" with no details refers to her previous request. One-off content changes (this word, this slide\'s text) are never lasting.',
    '  "settings_clash": null | {"topics": ["colors"|"fonts"|"elements"], "summary_he": "<short Hebrew: what she wants that her settings don\'t have>"} — ONLY when a LASTING preference needs a colour, a font or a brand element (logo / her uploaded graphics) that differs from or is missing in HER SETTINGS: a new colour, another font, a different logo. Using her existing colours, fonts or elements in some way is NOT a clash. Motion, transitions, how things enter, timing, layout, spacing, or a decorative shape the designer draws are never a clash.',
    '  "rule": "<one precise English rule a designer / animator can follow — fill it when lasting is true OR contradicts is not empty; otherwise empty>",',
    '  "summary_he": "<short Hebrew summary of that rule, for her>",',
    `  "scope": "all" | "carousel" | "story" | "image_post" | "b_roll" — what the rule is about. Use "${input.format}" when it is about this format's own behaviour (b-roll motion, how story frames connect, slide numbering…); "all" only when it is clearly about her look everywhere (an element's style, a mood, a habit across formats).`,
    '  "contradicts": [numbers of SAVED PREFERENCES her message goes against — also when it is a one-off edit doing the opposite of a saved preference. Only real opposites (thin vs thick, one word at a time vs all at once), not related-but-compatible. [] when none.]',
    "}",
  ]
    .filter((l) => l !== "")
    .join("\n")

  const client = new Anthropic({ apiKey: anthropicKey })
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 900,
    system: TRIAGE_SYSTEM,
    messages: [{ role: "user", content: [...referenceBlocks(input.refs ?? []), { type: "text", text }] }],
  })
  const json = parseJson<{
    edit?: boolean
    edit_instruction?: string
    lasting?: boolean
    settings_clash?: { topics?: string[]; summary_he?: string } | null
    rule?: string
    summary_he?: string
    scope?: string
    contradicts?: number[]
  }>(msg)

  const edit = json.edit !== false
  const editInstruction = json.edit_instruction?.trim() || input.instruction
  const lasting = !!json.lasting || !!input.explicit
  const rule = json.rule?.trim() ?? ""
  const summary = json.summary_he?.trim() ? stripDashes(json.summary_he.trim()) : input.instruction
  const scope: RuleScope = isRuleScope(json.scope) ? json.scope : input.format
  const contradicted = (json.contradicts ?? [])
    .map((n) => existing[Math.round(n) - 1])
    .filter((r): r is StyleRule => !!r)

  let memory: MemoryOutcome
  const clashTopics = (json.settings_clash?.topics ?? []).filter(
    (t): t is SettingsTopic => t === "colors" || t === "fonts" || t === "elements",
  )
  if (lasting && json.settings_clash && clashTopics.length) {
    memory = {
      kind: "settings",
      topics: clashTopics,
      summary: stripDashes(json.settings_clash.summary_he?.trim() || summary),
    }
  } else if (contradicted.length && rule) {
    memory = {
      kind: "conflict",
      previous: contradicted.map((r) => ({ id: r.id, summary: r.summary_he })),
      proposal: { rule, summary_he: summary, scope },
    }
  } else if (lasting && rule) {
    const saved: StyleRule = {
      id: randomUUID(),
      rule,
      summary_he: summary,
      scope,
      source: input.format,
      at: new Date().toISOString(),
    }
    await saveStyleRules(supabase, userId, [...existing, saved].slice(-MAX_RULES))
    memory = { kind: "saved", id: saved.id, summary: saved.summary_he, scope }
  } else {
    memory = { kind: "none", ...(input.explicit ? { explicit: true } : {}) }
  }
  return { edit, editInstruction, memory }
}

/**
 * "באופן רוחבי": the new preference replaces the ones it contradicted. It
 * keeps its scope when they all share it, otherwise it applies everywhere.
 */
export async function replaceStyleRules(
  supabase: SupabaseClient,
  userId: string,
  replaceIds: string[],
  proposal: { rule: string; summary_he: string; scope: RuleScope },
): Promise<StyleRule> {
  const existing = await loadForWrite(supabase, userId)
  const replaced = existing.filter((r) => replaceIds.includes(r.id))
  const scope: RuleScope = replaced.every((r) => r.scope === proposal.scope) ? proposal.scope : "all"
  const rule: StyleRule = {
    id: randomUUID(),
    rule: proposal.rule.trim(),
    summary_he: stripDashes(proposal.summary_he.trim()),
    scope,
    source: proposal.scope,
    at: new Date().toISOString(),
  }
  await saveStyleRules(supabase, userId, [...existing.filter((r) => !replaceIds.includes(r.id)), rule].slice(-MAX_RULES))
  return rule
}

/** Delete one preference. Returns whether it was there. */
export async function deleteStyleRule(supabase: SupabaseClient, userId: string, id: string): Promise<boolean> {
  const rules = await loadForWrite(supabase, userId)
  const next = rules.filter((r) => r.id !== id)
  if (next.length === rules.length) return false
  await saveStyleRules(supabase, userId, next)
  return true
}

/**
 * She edited a preference's Hebrew text in the settings tab: the English rule
 * the generators read is re-written from it (one short Claude call).
 */
export async function updateStyleRule(
  supabase: SupabaseClient,
  userId: string,
  anthropicKey: string,
  id: string,
  summaryHe: string,
): Promise<StyleRule | null> {
  const rules = await loadForWrite(supabase, userId)
  const idx = rules.findIndex((r) => r.id === id)
  if (idx < 0) return null
  const client = new Anthropic({ apiKey: anthropicKey })
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: TRIAGE_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          `She rewrote one of her saved visual preferences (it applies to: ${rules[idx].scope === "all" ? "every format" : FORMAT_NOUN[rules[idx].scope as VisualFormat]}).`,
          `Her text now (Hebrew): ${JSON.stringify(summaryHe)}`,
          `The English rule before: ${JSON.stringify(rules[idx].rule)}`,
          "",
          'Return {"rule": "<one precise English rule a designer / animator can follow, saying exactly what her text says now>"}.',
        ].join("\n"),
      },
    ],
  })
  const json = parseJson<{ rule?: string }>(msg)
  const next: StyleRule = {
    ...rules[idx],
    rule: json.rule?.trim() || summaryHe,
    summary_he: summaryHe.trim(),
    at: new Date().toISOString(),
  }
  await saveStyleRules(supabase, userId, rules.map((r, i) => (i === idx ? next : r)))
  return next
}

/** Every preference, newest first — the settings tab. */
export async function listStyleRules(supabase: SupabaseClient, userId: string): Promise<StyleRule[]> {
  return [...(await loadForWrite(supabase, userId))].reverse()
}
