import sharp from "sharp"
import { editImage, nearestShape } from "@/lib/openai-image"
import { picturesPlaced } from "@/lib/placed-check"
import type { ModelImage } from "@/lib/visual-language/image-input"
import { normaliseImage } from "@/lib/visual-language/image-input"

/**
 * A picture on a slide, changed for real (Hani, 2026-11-05 — "כשאני מבקשת
 * שמשהו ישתלב הוא כבר יעשה את זה כמו שצריך"). She asked to remove the caption
 * from her photo on slide 1; the layout engine could only crop the photo to
 * a thin strip to hide it. Now the PICTURE goes through the image model
 * (gpt-image, her key — the same edit call the image post uses), and the
 * result is placed back on the slide by the carousel engine.
 *
 * Honest by construction:
 *   - the result must visibly differ from the picture (else nothing changed);
 *   - her subject must still be recognisably there (lib/placed-check) — a
 *     different person or a look-alike is not kept;
 *   - on either miss nothing is saved and she is told so. The caller never
 *     falls back to a crop.
 */

export type PictureEditResult = { ok: true; png: Buffer } | { ok: false; message: string }

import { PICTURE_NOT_HERS, PICTURE_UNCHANGED } from "@/lib/picture-edit-copy"
export { PICTURE_MISSING, PICTURE_NOT_HERS, PICTURE_UNCHANGED } from "@/lib/picture-edit-copy"

function prompt(edit: string): string {
  return [
    "Edit this picture. It is the creator's own picture (a photo, character, illustration or product) that sits on a slide of her carousel. Apply ONLY the following change to the picture itself:",
    edit,
    "",
    "Keep the subject exactly who and what it is — the same person, face, body, pose, clothing, character or object, same details and proportions. Never replace the person, never re-imagine the subject. Where the change removes something (text, a caption, a logo, a watermark, an object), rebuild what was behind it naturally so nothing looks erased. Where it extends the picture, continue it seamlessly. Do not add text. Do not crop the subject.",
  ].join("\n")
}

/** Share of the picture that visibly changed (0..1) — same measure as the image edits. */
async function changedArea(before: Buffer, after: Buffer): Promise<number> {
  const grid = (input: Buffer) => sharp(input).greyscale().resize(54, 68, { fit: "fill" }).raw().toBuffer()
  const [a, b] = await Promise.all([grid(before), grid(after)])
  let moved = 0
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 24) moved++
  return moved / a.length
}

/**
 * `source`: the picture as it is now (her file, or the slide's current
 * picture). `claudeKey`: for the "still her" check — without it the check is
 * skipped (never a false failure).
 */
export async function editPicture(
  openaiKey: string,
  claudeKey: string | null,
  source: Buffer,
  edit: string,
): Promise<PictureEditResult> {
  const meta = await sharp(source).rotate().metadata()
  const shape = nearestShape(meta.width ?? 1, meta.height ?? 1)
  const input: ModelImage = await normaliseImage(source)
  const out = Buffer.from(await editImage(openaiKey, prompt(edit), input, shape), "base64")
  if ((await changedArea(Buffer.from(input.base64, "base64"), out)) < 0.01) {
    return { ok: false, message: PICTURE_UNCHANGED }
  }
  if ((await picturesPlaced(claudeKey, [input], out.toString("base64"))) === false) {
    return { ok: false, message: PICTURE_NOT_HERS }
  }
  return { ok: true, png: await sharp(out).png().toBuffer() }
}
