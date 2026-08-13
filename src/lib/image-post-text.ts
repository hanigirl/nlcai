/**
 * The text that belongs ON an image-post picture.
 *
 * Lifted out of `api/image-post/generate-media` so the caption burner can
 * read the SAME lines the AI generator bakes in. That equivalence is the
 * whole point of the feature: a post must say the same thing whether its
 * picture was drawn by the model or brought by the user from Drive. Two
 * copies of this parser would drift, and the drift would only ever show up
 * as "the AI image says one thing and mine says another".
 */

export interface ImagePostTexts {
  headline: string
  subheadline?: string
  bottom?: string
}

/**
 * Parse the image_post variant body. Canonical shape (from
 * buildImagePostPrompt) is labeled blocks:
 *
 *   [כותרת]\n...\n\n[תת-כותרת]\n...\n\n[טקסט תחתון]\n...
 *
 * Users can freely edit the variant text, so if the labels are gone we
 * fall back to: first non-empty line = headline, the rest = subheadline.
 */
export function parseImagePostBody(body: string): ImagePostTexts | null {
  const grab = (tag: string): string => {
    const m = body.match(
      new RegExp(`\\[${tag}\\]\\s*\\n?([\\s\\S]*?)(?=\\n\\[|$)`),
    )
    return m?.[1]?.trim() ?? ""
  }

  const headline = grab("כותרת")
  if (headline) {
    return {
      headline,
      subheadline: grab("תת-כותרת") || undefined,
      bottom: grab("טקסט תחתון") || undefined,
    }
  }

  const lines = body
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length === 0) return null
  return {
    headline: lines[0],
    subheadline: lines.slice(1).join(" ") || undefined,
  }
}
