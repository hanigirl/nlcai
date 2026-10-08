import Anthropic from "@anthropic-ai/sdk"
import type { FileContent } from "@/lib/extract-file-content"

/**
 * Knowledge sources → hook material.
 *
 * A source is usually a transcript: a 40-minute call or a 3-hour webinar.
 * The old pipeline squeezed the whole thing into one 3–6 sentence summary,
 * and the generators then read at most 2,000 characters across ALL sources —
 * so a webinar's 30,000 words became one paragraph, and every hook batch saw
 * the same paragraph.
 *
 * Now each source is read in full, in chunks, and mined for discrete
 * "insights": a story, a quote, a number, a pain the audience voiced, an
 * opinion, a tip. Each is a self-contained seed for a hook. The generators
 * sample from that pool (see `business-source-insights.ts`), so successive
 * batches draw on different moments of the same webinar.
 *
 * Runs on the user's own Anthropic key.
 */

const MODEL = "claude-opus-5-5"

/** ~30k chars per call: big enough to keep context, small enough to run in parallel. */
const CHUNK_CHARS = 30_000

/**
 * Hard ceiling on what we read from one source — roughly a 4–5 hour
 * transcript. Anything past it is reported to the user, never dropped silently.
 */
export const MAX_SOURCE_CHARS = 600_000

export const INSIGHT_KINDS = ["story", "quote", "number", "pain", "opinion", "tip"] as const
export type InsightKind = (typeof INSIGHT_KINDS)[number]
export type SourceInsight = { kind: InsightKind; text: string }

export type ProcessedSource = { summary: string; insights: SourceInsight[] }

const EXTRACT_PROMPT = `את קוראת חלק ממקור ידע של עסק — לרוב תמלול של פגישה או וובינר, לפעמים מסמך. המטרה: לחלץ ממנו חומר גלם שממנו ייכתבו הוקים ופוסטים לרשתות.

חלצי "תובנות" — כל אחת יחידה עצמאית שאפשר לבנות ממנה הוק בלי לקרוא את המקור:
- story — סיפור, מקרה או דוגמה אמיתית שסופרו (מי, מה קרה, מה יצא)
- quote — משפט חזק או ניסוח אופייני של הדוברת, כמעט מילה במילה
- number — נתון, מספר או תוצאה מדידה, עם ההקשר שלו
- pain — כאב, פחד או התלבטות שהקהל או לקוחות העלו, בשפה שלהם
- opinion — עמדה, אמונה או דעה לא שגרתית של בעלת העסק
- tip — עצה או שיטה קונקרטית שאפשר ליישם

כללים:
1. כתבי תמיד בעברית, גם אם המקור באנגלית. ציטוטים — שמרי על הניסוח המקורי ככל האפשר.
2. אל תמציאי. רק מה שנאמר בפועל.
3. כל תובנה: 1–3 משפטים, מובנת בלי הקשר.
4. דלגי על פתיחות, תודות, לוגיסטיקה ושיחת חולין.
5. עד 25 תובנות לחלק — העדיפי את החזקות והספציפיות.

החזירי JSON בלבד, בלי טקסט לפני או אחרי:
{"summary": "2–3 משפטים על מה החלק הזה", "insights": [{"kind": "story", "text": "..."}]}`

const MERGE_SUMMARY_PROMPT = `לפנייך סיכומים של חלקים רצופים מאותו מקור ידע (תמלול או מסמך). כתבי סיכום אחד של המקור כולו: 3–6 משפטים בעברית, פסקה אחת, בלי כותרות ובלי bullets. אל תמציאי פרטים. החזירי רק את הסיכום.`

/** Split on line boundaries so a sentence is never cut between two chunks. */
export function chunkText(text: string, size = CHUNK_CHARS): string[] {
  const chunks: string[] = []
  let rest = text
  while (rest.length > size) {
    let cut = rest.lastIndexOf("\n", size)
    if (cut < size * 0.6) cut = rest.lastIndexOf(" ", size)
    if (cut <= 0) cut = size
    chunks.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut)
  }
  if (rest.trim()) chunks.push(rest.trim())
  return chunks
}

async function ask(client: Anthropic, content: Anthropic.ContentBlockParam[]): Promise<string> {
  // Server-side fallback: if a safety classifier declines (rare for business
  // transcripts, but a transcript can quote anything), the API re-runs the
  // request on a fallback model inside the same call instead of failing.
  const message = (await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16_000,
    output_config: { effort: "medium" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    messages: [{ role: "user", content }],
  } as never)) as Anthropic.Beta.BetaMessage

  if (message.stop_reason === "refusal") throw new Error("refusal")
  const text = message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim()
  if (!text) throw new Error("empty_response")
  return text
}

function parseExtraction(raw: string): ProcessedSource {
  const start = raw.indexOf("{")
  const end = raw.lastIndexOf("}")
  if (start < 0 || end <= start) throw new Error("no_json")
  const parsed = JSON.parse(raw.slice(start, end + 1)) as {
    summary?: unknown
    insights?: unknown
  }
  const insights = (Array.isArray(parsed.insights) ? parsed.insights : [])
    .map((i) => i as { kind?: unknown; text?: unknown })
    .filter(
      (i): i is SourceInsight =>
        typeof i.text === "string" &&
        i.text.trim().length > 0 &&
        INSIGHT_KINDS.includes(i.kind as InsightKind),
    )
    .map((i) => ({ kind: i.kind, text: i.text.trim() }))
  return {
    summary: typeof parsed.summary === "string" ? parsed.summary.trim() : "",
    insights,
  }
}

/**
 * Read a whole source and return its summary + insight pool.
 *
 * Text is chunked and every chunk is read in parallel — a 3-hour transcript
 * is ~6 chunks, so it takes about as long as one. A PDF goes in as a single
 * document (the API reads it natively, and the 10MB upload cap bounds it).
 */
export async function processKnowledgeSource(
  client: Anthropic,
  content: Extract<FileContent, { kind: "text" | "pdf" }>,
): Promise<ProcessedSource> {
  if (content.kind === "pdf") {
    const raw = await ask(client, [
      {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: content.base64 },
      },
      { type: "text", text: EXTRACT_PROMPT },
    ])
    return parseExtraction(raw)
  }

  const chunks = chunkText(content.text)
  const parts = await Promise.all(
    chunks.map(async (chunk, i) => {
      const header =
        chunks.length > 1 ? `\n\n(חלק ${i + 1} מתוך ${chunks.length})` : ""
      const raw = await ask(client, [
        { type: "text", text: `${EXTRACT_PROMPT}${header}\n\n--- התוכן ---\n${chunk}` },
      ])
      return parseExtraction(raw)
    }),
  )

  const insights = parts.flatMap((p) => p.insights)
  if (parts.length === 1) return { summary: parts[0].summary, insights }

  const summary = await ask(client, [
    {
      type: "text",
      text: `${MERGE_SUMMARY_PROMPT}\n\n${parts
        .map((p, i) => `חלק ${i + 1}: ${p.summary}`)
        .join("\n")}`,
    },
  ])
  return { summary, insights }
}
