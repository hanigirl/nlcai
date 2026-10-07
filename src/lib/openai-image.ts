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

interface Options {
  quality?: Quality
  references?: ModelImage[]
}

// gpt-image-2 has no documented 9:16 or 4:5 — every caller asks for the
// closest portrait and center-crops afterwards.
const SIZE = "1024x1536"

class BillingError extends Error {}

async function readResult(res: Response): Promise<string> {
  const json = (await res.json().catch(() => null)) as {
    data?: Array<{ b64_json?: string }>
    error?: { message?: string }
  } | null
  if (!res.ok || !json?.data?.[0]?.b64_json) {
    const detail = json?.error?.message || `OpenAI החזיר ${res.status}`
    if (/billing|quota|insufficient/i.test(detail)) throw new BillingError(BILLING_MESSAGE)
    throw new Error(detail)
  }
  return json.data[0].b64_json
}

async function generate(apiKey: string, prompt: string, quality?: Quality): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-image-2",
      prompt,
      size: SIZE,
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
  quality?: Quality,
): Promise<string> {
  const form = new FormData()
  form.append("model", "gpt-image-2")
  form.append("prompt", prompt)
  form.append("size", SIZE)
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

export async function generateImage(
  apiKey: string,
  prompt: string,
  { quality, references }: Options = {},
): Promise<string> {
  if (references?.length) {
    try {
      return await edit(apiKey, prompt, references, quality)
    } catch (err) {
      if (err instanceof BillingError) throw err
      console.error("[openai-image] edits with brand elements failed, generating without them:", err)
    }
  }
  return generate(apiKey, prompt, quality)
}
