import { scriptUnits } from "@/lib/own-media-plan"
import type { OwnEditFormat } from "@/lib/own-media"

/**
 * The format's script as the hard text rule for an edit of AI-made media
 * (Hani, 2026-11-09: "ג׳נרט מחדש עם הטקסט המעודכן" said done and nothing
 * changed — the edit kept the image's old words and never read the script).
 * Appended to what the edit models read: the words on the media are the
 * script's, word for word; where they differ, they become the script's.
 */
export function scriptTextNote(format: OwnEditFormat, body: string | null | undefined): string {
  const units = scriptUnits(format, body)
  if (!units.length) return ""
  const item = format === "carousel" ? "slide" : format === "story" ? "frame" : "piece"
  const lines = units.map((u, i) =>
    `${units.length > 1 ? `${item} ${i + 1}: ` : ""}${[u.headline, u.body].filter(Boolean).map((t) => JSON.stringify(t)).join(" / ")}`,
  )
  return [
    "",
    "",
    "HARD RULE — the text on this media is the format's CURRENT SCRIPT, word for word (Hebrew, RTL). Wherever the media's words differ from it (she edited the script), the edit rewrites them to exactly these words. Never other words, never shortened or reworded:",
    ...lines,
  ].join("\n")
}
