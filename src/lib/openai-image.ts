import type { ModelImage } from "@/lib/visual-language/image-input"

/**
 * One gpt-image-2 call (BYOK — users.openai_api_key), shared by every AI
 * media generator: story, image post, AI carousel, b-roll.
 *
 * With `references` (the creator's own graphic elements — logo, icons,
 * stickers) it goes through /images/edits, which accepts input images, so
 * the model reproduces her real element instead of inventing a look-alike.
 * If that path fails for a non-billing reason we log it and fall back to a
 * plain generation — the image still matches her visual language, it just
 * goes without the element. A missing logo beats a failed story.
 */

const BILLING_MESSAGE =
  "מפתח ה-OpenAI שלכם הגיע לתקרת החיוב. היכנסו ל-platform.openai.com → Billing כדי להוסיף קרדיט או להעלות את התקרה, ונסו שוב."

type Quality = "high" | "medium" | "low" | "auto"

/**
 * The shape to paint. gpt-image-2 accepts custom sizes (both edges multiples
 * of 16, 0.65–8.3MP), so we ask for the EXACT final ratio and only scale
 * afterwards — nothing gets trimmed. Cropping a 2:3 render to 4:5 used to cut
 * corner elements (her badge, the slide tab) clean off.
 */
export type ImageShape = "4:5" | "9:16"

const SHAPE_SIZE: Record<ImageShape, string> = {
  "4:5": "1088x1360", // → 1080×1350 feed post / carousel slide
  "9:16": "1008x1792", // → 1080×1920 story / b-roll
}

// The old universal size. Only used if OpenAI ever refuses a custom size;
// callers center-crop, so the prompt's keep-inside-the-frame rule matters.
const FALLBACK_SIZE = "1024x1536"

interface Options {
  shape: ImageShape
  quality?: Quality
  references?: ModelImage[]
}

class BillingError extends Error {}
class SizeRejectedError extends Error {}

async function readResult(res: Response): Promise<string> {
  const json = (await res.json().catch(() => null)) as {
    data?: Array<{ b64_json?: string }>
    error?: { message?: string }
  } | null
  if (!res.ok || !json?.data?.[0]?.b64_json) {
    const detail = json?.error?.message || `OpenAI החזיר ${res.status}`
    if (/billing|quota|insufficient/i.test(detail)) throw new BillingError(BILLING_MESSAGE)
    if (res.status === 400 && /size/i.test(detail)) throw new SizeRejectedError(detail)
    throw new Error(detail)
  }
  return json.data[0].b64_json
}

async function generate(
  apiKey: string,
  prompt: string,
  size: string,
  quality?: Quality,
): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-image-2",
      prompt,
      size,
      ...(quality ? { quality } : {}),
      n: 1,
    }),
  })
  return readResult(res)
}

async function edit(
  apiKey: string,
  prompt: string,
  references: ModelImage[],
  size: string,
  quality?: Quality,
): Promise<string> {
  const form = new FormData()
  form.append("model", "gpt-image-2")
  form.append("prompt", prompt)
  form.append("size", size)
  form.append("n", "1")
  if (quality) form.append("quality", quality)
  references.forEach((ref, i) => {
    const ext = ref.mediaType === "image/png" ? "png" : "jpg"
    form.append(
      "image[]",
      new Blob([Buffer.from(ref.base64, "base64")], { type: ref.mediaType }),
      `reference-${i + 1}.${ext}`,
    )
  })
  const res = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })
  return readResult(res)
}

async function attempt(
  apiKey: string,
  prompt: string,
  size: string,
  { quality, references }: Omit<Options, "shape">,
): Promise<string> {
  if (references?.length) {
    try {
      return await edit(apiKey, prompt, references, size, quality)
    } catch (err) {
      if (err instanceof BillingError || err instanceof SizeRejectedError) throw err
      console.error("[openai-image] edits with brand elements failed, generating without them:", err)
    }
  }
  return generate(apiKey, prompt, size, quality)
}

export async function generateImage(
  apiKey: string,
  prompt: string,
  { shape, ...rest }: Options,
): Promise<string> {
  try {
    return await attempt(apiKey, prompt, SHAPE_SIZE[shape], rest)
  } catch (err) {
    if (!(err instanceof SizeRejectedError)) throw err
    console.error(`[openai-image] ${SHAPE_SIZE[shape]} refused, falling back to ${FALLBACK_SIZE}:`, err.message)
    return attempt(apiKey, prompt, FALLBACK_SIZE, rest)
  }
}

/**
 * Prompt rule shared by every generator: nothing touches or crosses the
 * edge. Hani, 2026-10-07 — a badge in the bottom-left or a tab in the
 * top-right corner must arrive whole.
 */
export const KEEP_INSIDE_FRAME_RULE =
  "- NOTHING IS CROPPED: every element — text, badges, portraits, logos, tabs, arrows, numbers, icons — sits COMPLETELY inside the frame with a clear margin (at least 5% of the width) from every edge and every corner. Corner elements (bottom-left, bottom-right, top-left, top-right) are drawn whole, never cut off or bleeding off the edge. Only plain background colour, gradient or texture may reach the edges."
