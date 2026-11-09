import { scriptBlocks, storyFrames, stripFrameMarkers } from "@/lib/story-text-split"
import { parseTextToSlides } from "@/lib/carousel-slides"
import { parseImagePostBody } from "@/lib/image-post-text"

/**
 * THE text that goes on a format's media — one unit per frame / slide, split
 * one way for every path (Hani, 2026-11-09: "apply the text of the script,
 * not add any additional text"). The panel import, the caption routes, the
 * AI chat edit and the checks all read it from here, so the same frame can
 * never get different words depending on how it was made.
 *
 * No fallback: a frame the script has no text for gets `null`, never the
 * hook or the title (that fallback was where "invented" text came from).
 */

export type ScriptTextFormat = "story" | "carousel" | "image_post" | "b_roll"
export type ScriptText = { headline?: string; body?: string }

/** Where the words on a render came from — written with its caption record. */
export type TextSource = "script" | "dictated" | "hook-fallback" | "model"

const clean = (u: ScriptText): ScriptText | null => {
  const headline = u.headline?.trim() || undefined
  const body = u.body?.trim() || undefined
  return headline || body ? { headline, body } : null
}
const keep = (list: (ScriptText | null)[]) => list.filter((u): u is ScriptText => !!u)

export function scriptTextUnits(format: ScriptTextFormat | string, variantBody: string | null | undefined): ScriptText[] {
  const body = variantBody ?? ""
  if (!body.trim()) return []
  switch (format) {
    case "story":
      return keep(
        storyFrames(body).map((text, k) => {
          if (k > 0) return clean({ body: text })
          const [headline, ...rest] = scriptBlocks(text)
          return clean({ headline, body: rest.join("\n\n") })
        }),
      )
    case "carousel":
      // Split on the "שקופית N" headers FIRST — stripping the marks before
      // the split turned the headers into blank-line splits, so a slide with
      // two paragraphs became two slides (and every slide after it shifted).
      return keep(
        parseTextToSlides(body).map((sl) =>
          clean({ headline: stripFrameMarkers(sl.title ?? ""), body: stripFrameMarkers(sl.body ?? "") }),
        ),
      )
    case "image_post": {
      const t = parseImagePostBody(body)
      return t ? keep([clean({ headline: t.headline, body: [t.subheadline, t.bottom].filter(Boolean).join("\n") })]) : []
    }
    default: {
      // b-roll (one piece): the hook line, then the reading caption.
      const lines = stripFrameMarkers(body).split("\n").map((l) => l.trim()).filter(Boolean)
      return lines.length ? keep([clean({ headline: lines[0], body: lines.slice(1).join(" ") })]) : []
    }
  }
}

/** Frame / slide `index` (0-based); single-piece formats ignore it. `null` = the script has no text for it. */
export function scriptTextFor(
  format: ScriptTextFormat | string,
  variantBody: string | null | undefined,
  index = 0,
): ScriptText | null {
  const units = scriptTextUnits(format, variantBody)
  const single = format === "image_post" || format === "b_roll"
  return (single ? units[0] : units[index]) ?? null
}

/** Shown when a frame has no script text — instead of inventing some. */
export const NO_SCRIPT_TEXT = "אין בסקריפט טקסט לפריים הזה, אז לא שמתי עליו טקסט. אפשר להוסיף אותו בסקריפט ולנסות שוב."
