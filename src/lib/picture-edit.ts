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

/**
 * She asked to put her picture on a slide "as is" — "כמו שהיא", "בלי
 * לשנות", "אחד לאחד". Only then is her exact file placed untouched.
 */
export function wantsPictureAsIs(text: string | null | undefined): boolean {
  return !!text && /כמו\s*שה(?:יא|וא)|כמות\s*שה(?:יא|וא)|אחד\s*ל\s*-?\s*אחד|1\s*[:/]\s*1|בלי\s*לשנות|as[\s-]is|exactly\s+as|unchanged/i.test(text)
}

/**
 * Her picture made INTO a slide's picture (Hani, 2026-11-05): dropped in raw,
 * her meeting-room photo was cropped into the slot with the title over its
 * busiest part and a strip of the old design around it. Now it goes through
 * the image model first — re-framed to the slot's exact shape (the scene is
 * extended, the person never cut), graded into her visual language, kept
 * calm where the title lies over it, any caption in it removed — and only
 * then placed. Her subject must still be hers (lib/placed-check); on a miss
 * nothing is placed — never a raw crop instead.
 */
export async function adaptPictureForSlide(
  openaiKey: string,
  claudeKey: string | null,
  source: Buffer,
  slot: { width: number; height: number; textOver: "top" | "middle" | "bottom" | null },
  styleLines: string[],
  slideNumber: number,
): Promise<PictureEditResult> {
  // Each picture on its own slide, in one call of its own — at most
  // ADAPT_CONCURRENCY at a time, so filling every slide of a carousel at
  // once (the slide slots, up to 10) doesn't burst the image model's limits.
  await adaptSlot()
  try {
    return await adaptOne(openaiKey, claudeKey, source, slot, styleLines, slideNumber)
  } finally {
    adaptDone()
  }
}

const ADAPT_CONCURRENCY = 3
let adapting = 0
const adaptQueue: (() => void)[] = []
function adaptSlot(): Promise<void> {
  if (adapting < ADAPT_CONCURRENCY) {
    adapting++
    return Promise.resolve()
  }
  return new Promise((resolve) => adaptQueue.push(resolve))
}
function adaptDone() {
  const next = adaptQueue.shift()
  if (next) next()
  else adapting--
}

async function adaptOne(
  openaiKey: string,
  claudeKey: string | null,
  source: Buffer,
  slot: { width: number; height: number; textOver: "top" | "middle" | "bottom" | null },
  styleLines: string[],
  slideNumber: number,
): Promise<PictureEditResult> {
  const shape = nearestShape(slot.width, slot.height)
  const input: ModelImage = await normaliseImage(source)
  const language = styleLines.join("\n").slice(0, 2500)
  const prompt = [
    `Adapt this photo to be the picture on slide ${slide(slideNumber)} of the creator's Instagram carousel. It is HER picture: the person (or subject) in it must stay exactly who and what it is — the same face, hair, body, pose, clothing and details. Never replace, re-imagine or beautify the person.`,
    "",
    `- Re-frame it to the new ${shape} shape. Where the frame needs more picture, extend the scene naturally and seamlessly. Never crop or cut the person; keep them whole and well placed in the frame.`,
    "- Grade it into her visual language below so it looks designed together with the slide: colour grade, palette, light, grain and her graphic motifs where they fit (e.g. a pixel mosaic dissolving at the edges) — while the photo stays a real photo.",
    slot.textOver
      ? `- The slide's title is laid over the ${slot.textOver} of this picture. Keep that area calm and low-detail, gently darkened or softened, so white or light text reads clearly — without hiding the person.`
      : "- No text is laid over this picture.",
    "- Remove any text, captions, logos or watermarks inside the photo and rebuild what was behind them naturally. Add no text, letters or numbers.",
    "- Add no new person, character, animal or object.",
    "",
    "Her visual language:",
    language,
  ].join("\n")
  const out = Buffer.from(await editImage(openaiKey, prompt, input, shape), "base64")
  if ((await picturesPlaced(claudeKey, [input], out.toString("base64"))) === false) {
    return { ok: false, message: PICTURE_NOT_HERS }
  }
  return { ok: true, png: await sharp(out).png().toBuffer() }
}

function slide(n: number): string {
  return n === 1 ? "1 (the cover)" : String(n)
}
