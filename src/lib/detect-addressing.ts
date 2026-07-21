import Anthropic from "@anthropic-ai/sdk"

export type AddressGender = "masculine" | "feminine" | "plural"

/**
 * Detects how the user's draft addresses the reader (2nd person), so the
 * generation prompt can state it as a hard requirement instead of asking the
 * model to infer priorities.
 *
 * Exists because prompt-priority alone loses: with a female audience-identity
 * in context, Sonnet rewrote a draft's explicit "אתה" into "את" every time —
 * it "corrects" the user toward the audience. A detected gender is injected
 * as a single non-negotiable directive, which the model does follow.
 *
 * Code pass first (unambiguous markers only, zero latency), Haiku fallback for
 * the morphology regex can't safely do (bare feminine "את" collides with the
 * direct-object marker).
 */
export function detectAddressGenderFromText(text: string): AddressGender | null {
  const word = (w: string) => new RegExp(`(^|[^א-ת"'])${w}($|[^א-ת"'])`).test(text)
  // Plural checked before masculine: a draft mixing "אתם" and generic
  // masculine verbs is addressing a group.
  if (["אתם", "אתן", "לכם", "לכן", "שלכם", "שלכן", "אצלכם", "אצלכן"].some(word)) return "plural"
  if (["אתה", "שאתה", "כשאתה", "ואתה"].some(word)) return "masculine"
  // Unambiguously feminine 2nd-person: pronoun+prefix forms that can't be the
  // object marker, and common imperative/future feminine verbs.
  if (["כשאת", "שאת", "ואת את", "תרגישי", "תכתבי", "תעשי", "תקבלי", "תתחילי", "תפסיקי", "שאלי", "כתבי", "הגיבי", "תצליחי", "תבחרי", "תשאלי"].some(word)) return "feminine"
  return null
}

/**
 * Full detection: code pass, then a short Haiku call for drafts whose
 * addressing the regex can't classify. Returns null when the draft simply
 * doesn't address the reader (third-person / impersonal writing) — the
 * caller then falls back to audience-derived gender.
 *
 * Never throws: detection is an enhancement, not a dependency — a failed
 * call degrades to the audience fallback rather than failing generation.
 */
export async function detectAddressGender(
  apiKey: string,
  draft: string,
): Promise<AddressGender | null> {
  const fromCode = detectAddressGenderFromText(draft)
  if (fromCode) return fromCode

  try {
    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 10,
      messages: [
        {
          role: "user",
          content: `באיזה גוף הטקסט הבא פונה אל הקורא (גוף שני)?

"""
${draft}
"""

ענה במילה אחת בלבד:
- זכר — אם הפנייה היא לזכר יחיד (אתה, תעשה)
- נקבה — אם הפנייה היא לנקבה יחידה (את, תעשי)
- רבים — אם הפנייה היא לרבים (אתם, תעשו)
- אין — אם הטקסט לא פונה לקורא בגוף שני בכלל`,
        },
      ],
    })
    const answer = message.content.find((b) => b.type === "text")?.text?.trim() ?? ""
    if (answer.includes("זכר")) return "masculine"
    if (answer.includes("נקבה")) return "feminine"
    if (answer.includes("רבים")) return "plural"
    return null
  } catch {
    return null
  }
}
