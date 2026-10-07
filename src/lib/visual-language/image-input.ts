import sharp from "sharp"

/**
 * Turn a stored image (or a website link) into something both Claude and
 * OpenAI accept: PNG/JPEG, at most ~1600px on the long side.
 *
 * Uploads can be SVG (Claude rejects it), HEIC-sized photos, or 10MB PNGs —
 * normalising here keeps every downstream caller simple.
 */

const MAX_EDGE = 1600

export interface ModelImage {
  mediaType: "image/png" | "image/jpeg"
  base64: string
}

export async function loadImageForModels(url: string): Promise<ModelImage> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`image fetch ${res.status}`)
  const input = Buffer.from(await res.arrayBuffer())
  return normaliseImage(input)
}

export async function normaliseImage(input: Buffer): Promise<ModelImage> {
  const img = sharp(input, { density: 200 }).rotate()
  const meta = await img.metadata()
  const resized = img.resize({
    width: MAX_EDGE,
    height: MAX_EDGE,
    fit: "inside",
    withoutEnlargement: true,
  })
  // Keep transparency for logos/elements; photos go out as JPEG to stay small.
  if (meta.hasAlpha || meta.format === "svg" || meta.format === "png") {
    const buf = await resized.png().toBuffer()
    return { mediaType: "image/png", base64: buf.toString("base64") }
  }
  const buf = await resized.jpeg({ quality: 85 }).toBuffer()
  return { mediaType: "image/jpeg", base64: buf.toString("base64") }
}

/**
 * A website / sales-page example: we never fetch the user's URL ourselves —
 * a screenshot service renders it, and we read the screenshot + the colour
 * palette it extracts. Returns null when the page can't be rendered (the
 * analysis then continues without it and tells her which link was skipped).
 */
export async function screenshotWebsite(
  link: string,
): Promise<{ image: ModelImage; palette: string[] } | null> {
  let parsed: URL
  try {
    parsed = new URL(link)
  } catch {
    return null
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null

  const api = new URL("https://api.microlink.io/")
  api.searchParams.set("url", parsed.toString())
  api.searchParams.set("screenshot", "true")
  api.searchParams.set("palette", "true")
  api.searchParams.set("meta", "false")
  api.searchParams.set("viewport.width", "1280")
  api.searchParams.set("viewport.height", "1600")

  try {
    const res = await fetch(api, { signal: AbortSignal.timeout(45_000) })
    if (!res.ok) return null
    const json = (await res.json()) as {
      status?: string
      data?: { screenshot?: { url?: string; palette?: string[] } }
    }
    const shotUrl = json.data?.screenshot?.url
    if (json.status !== "success" || !shotUrl) return null
    const image = await loadImageForModels(shotUrl)
    return { image, palette: (json.data?.screenshot?.palette ?? []).slice(0, 8) }
  } catch (err) {
    console.error("[visual-language][screenshot]", link, err)
    return null
  }
}
