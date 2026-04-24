import type Anthropic from "@anthropic-ai/sdk"
import { FALLBACK_MODEL } from "@/lib/anthropic-fallback"

// Batch classifier — runs ONCE per generation after all hooks are written,
// classifying all N hooks against the user's products in a single Haiku 4.5
// call. A hook can match multiple products (returned as an array) or none
// (general hook). Total cost: ~$0.01 per run of 20 hooks.

export interface ClassifierInput {
  hooks: Array<{ id: string; text: string }>
  products: Array<{ id: string; name: string; summary?: string }>
}

// Maps hook.id → product_ids matched (empty array = general/uncategorized).
export type ClassifierResult = Record<string, string[]>

export async function classifyHooksByProduct(
  client: Anthropic,
  input: ClassifierInput,
): Promise<ClassifierResult> {
  if (input.hooks.length === 0 || input.products.length === 0) {
    // No products → everything is "general" (empty product_ids).
    return Object.fromEntries(input.hooks.map((h) => [h.id, [] as string[]]))
  }

  const productsSection = input.products
    .map((p) => `- ${p.id}: "${p.name}"${p.summary ? ` — ${p.summary.slice(0, 200)}` : ""}`)
    .join("\n")

  const hooksSection = input.hooks
    .map((h) => `- ${h.id}: ${h.text}`)
    .join("\n")

  const prompt = `קיבלת רשימת מוצרים ורשימת הוקים של יוצר תוכן. המטרה: לסווג כל הוק למוצר/ים שהוא הכי רלוונטי אליהם.

## מוצרי המשתמש (מזהה: שם — תיאור)
${productsSection}

## הוקים (מזהה: טקסט)
${hooksSection}

## הוראות
- לכל הוק — החזר רשימת מזהי מוצרים שההוק רלוונטי אליהם.
- הוק יכול להתאים לכמה מוצרים ויופיע בכולם.
- הוק שהוא **כללי** (לא מתכתב עם מוצר ספציפי, אלא עוסק בנושא הרחב של היוצר) — החזר מערך ריק \`[]\`.
- אל תסווג בכוח — רק אם יש קשר ברור בין ההוק למוצר.

## פלט — JSON בלבד
\`\`\`json
{
  "hook_id_1": ["product_id_a", "product_id_b"],
  "hook_id_2": [],
  "hook_id_3": ["product_id_c"]
}
\`\`\`

התו הראשון \`{\`, האחרון \`}\`. בלי markdown, בלי הסברים.`

  try {
    const res = await client.messages.create({
      model: FALLBACK_MODEL, // Haiku 4.5 — cheap, classification is easy
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    })
    const raw = res.content.find((b) => b.type === "text")?.text ?? ""
    const parsed = extractJsonObject(raw)
    if (!parsed) {
      console.error("Classifier: response not parseable. First 300 chars:", raw.slice(0, 300))
      // Fall back to "everything is general" so the filter doesn't break
      return Object.fromEntries(input.hooks.map((h) => [h.id, [] as string[]]))
    }
    // Sanitize: only keep product_ids that actually exist in the user's list
    const validProductIds = new Set(input.products.map((p) => p.id))
    const result: ClassifierResult = {}
    for (const h of input.hooks) {
      const raw = (parsed as Record<string, unknown>)[h.id]
      result[h.id] = Array.isArray(raw)
        ? (raw as unknown[]).filter((x) => typeof x === "string" && validProductIds.has(x as string)) as string[]
        : []
    }
    return result
  } catch (err) {
    console.error("Classifier failed — defaulting all hooks to general:", err)
    return Object.fromEntries(input.hooks.map((h) => [h.id, [] as string[]]))
  }
}

function extractJsonObject(text: string): unknown | null {
  const trimmed = text.trim()
  if (trimmed.startsWith("{")) {
    try { return JSON.parse(trimmed) } catch { /* fall through */ }
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (fenced) {
    try { return JSON.parse(fenced[1]) } catch { /* fall through */ }
  }
  const firstBrace = trimmed.indexOf("{")
  const lastBrace = trimmed.lastIndexOf("}")
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try { return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) } catch { /* fall through */ }
  }
  return null
}
