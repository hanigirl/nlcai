/**
 * The description a format goes out with when she hasn't written one
 * (Hani, 2026-11-11):
 *
 *   b-roll, image post        → the whole core post
 *   carousel, talking head    → only its call to action
 *   story                     → none (Instagram stories carry no caption)
 *
 * The call to action is the core post's last paragraph — the generator always
 * closes on it (lib/agents/core-post-generator, "הנעה לפעולה (שורה אחרונה)").
 * One rule for the publish (lib/social/assemble), the calendar preview and
 * the canvas's תזמון tab, so what she sees is what is sent.
 */

const CTA_FORMATS = new Set(["carousel", "talking_head"])

/**
 * The core post's call to action: its last paragraph (a CTA sometimes runs
 * over two lines — "כתבו לי בתגובות" / "או שתדברו איתי בפרטי").
 */
export function callToAction(corePost: string | null | undefined): string {
  const paragraphs = (corePost ?? "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
  return paragraphs[paragraphs.length - 1] ?? ""
}

export function defaultDescription(format: string, corePost: string | null | undefined): string {
  if (format === "story") return ""
  if (CTA_FORMATS.has(format)) return callToAction(corePost)
  return (corePost ?? "").trim()
}
