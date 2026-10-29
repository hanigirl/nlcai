import { CLAUDE_KEY_INVALID_MESSAGE } from "@/lib/claude-credits"

/**
 * "עריכה עם AI" for the COPY of every format (Hani + Nataliya, 2026-10-22):
 * the same sparkle the core post has, on the carousel / story / talking-head /
 * image-post / b-roll text, before media is made. "תקצרו לי את זה ל-4
 * שקופיות ולא 8".
 *
 * This file is the client-safe half: which formats it covers, the quick
 * suggestions each one offers, how to describe a change in one line, and the
 * error copy. The prompt lives in lib/agents/format-copy-refiner.ts and the
 * route in api/format/refine.
 *
 * Copy only. The media AI edit (media-ai-chat.tsx) is a different surface and
 * a different task; nothing here touches it.
 */

export type CopyFormat = "carousel" | "story" | "talking_head" | "image_post" | "b_roll"

export const COPY_FORMATS: CopyFormat[] = ["story", "talking_head", "carousel", "image_post", "b_roll"]

export function isCopyFormat(fid: string): fid is CopyFormat {
  return (COPY_FORMATS as string[]).includes(fid)
}

/** "הטקסט של ה___" — used in panel titles and aria-labels. */
export const COPY_NOUN: Record<CopyFormat, string> = {
  carousel: "הקרוסלה",
  story: "הסטורי",
  talking_head: "התסריט לדיבור למצלמה",
  image_post: "הכיתוב לפוסט התמונה",
  b_roll: "הטקסט לבי-רול",
}

/**
 * One-tap requests per format. Written as the request itself (infinitive),
 * so a chip and a typed instruction travel the same path to the model. The
 * first chip is the format's most common ask: for the carousel it is the
 * exact example from the brief.
 */
export const COPY_SUGGESTIONS: Record<CopyFormat, string[]> = {
  carousel: ["לקצר ל-4 שקופיות", "רעיון אחד בכל שקופית", "CTA חד יותר בסוף"],
  story: ["לקצר לפריים אחד", "יותר אישי ובגובה העיניים", "לסיים בשאלה לקהל"],
  talking_head: ["לקצר ל-30 שניות", "פתיחה חזקה יותר", "יותר בשפה שלי"],
  image_post: ["לקצר את הכיתוב", "הנעה לפעולה ברורה יותר", "יותר אישי"],
  b_roll: ["לקצר את הטקסט על המסך", "ניסוח חד יותר", "עוד גרסה קצרה"],
}

const SLIDE_HEADER = /^\s*שקופית\s+\d+\s*$/gm

/** Carousel copy marks each slide with a "שקופית N" line (carousel-generator). */
export function countSlides(text: string): number {
  return (text.match(SLIDE_HEADER) ?? []).length
}

function countWords(text: string): number {
  return text.replace(SLIDE_HEADER, " ").split(/\s+/).filter(Boolean).length
}

/**
 * The one-line "what changed" the user sees next to keep/undo — the measure
 * that format is judged by. Slides for the carousel, length for everything
 * else. Null when nothing measurable moved (a tone change), in which case
 * the AI's own sentence carries it.
 */
export function describeCopyChange(fid: CopyFormat, before: string, after: string): string | null {
  if (fid === "carousel") {
    const a = countSlides(before)
    const b = countSlides(after)
    if (a && b && a !== b) return `${a} שקופיות ← ${b} שקופיות`
  }
  const a = countWords(before)
  const b = countWords(after)
  if (!a || !b || a === b) return null
  return `${a} מילים ← ${b} מילים`
}

export const COPY_REFINE_ERROR_COPY: Record<string, string> = {
  anthropic_not_connected: "כדי לערוך עם AI צריך לחבר את חשבון Claude בהגדרות.",
  credits_exhausted: "נגמרו הקרדיטים ב-Claude. בדקו את החשבון ונסו שוב.",
  anthropic_overloaded: "השרתים של Claude עמוסים כרגע. נסו שוב בעוד רגע.",
  anthropic_key_invalid: CLAUDE_KEY_INVALID_MESSAGE,
}

export const COPY_REFINE_GENERIC_ERROR = "משהו השתבש. נסו שוב."

export interface CopyRefineTurn {
  role: "user" | "assistant"
  content: string
}

export interface CopyRefineResult {
  reply: string
  revisedText: string
}

/** POST /api/format/refine. Throws an Error whose message is the user-facing copy. */
export async function requestFormatCopyRefine(input: {
  format: CopyFormat
  currentText: string
  hook?: string
  messages: CopyRefineTurn[]
}): Promise<CopyRefineResult> {
  let res: Response
  try {
    res = await fetch("/api/format/refine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    })
  } catch {
    throw new Error("שגיאת רשת. נסו שוב.")
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.error) {
    throw new Error(COPY_REFINE_ERROR_COPY[data.error] ?? COPY_REFINE_GENERIC_ERROR)
  }
  return { reply: data.reply || "עדכנתי את הטקסט.", revisedText: data.revisedText || "" }
}
