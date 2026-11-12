"use client"

import { isVideoSlide } from "@/lib/carousel-video"
import { isOwnCarousel } from "@/lib/carousel-own"
import { makeCarouselVideoSlide, uploadSlotPicture } from "@/lib/carousel-video-client"
import { useOwnMediaText } from "@/lib/use-scheduling-access"
import type { AsIsItem } from "@/lib/as-is-upload"
import type { CaptionRecord } from "@/lib/own-media"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import { getCurrentUser } from "@/lib/supabase/current-user"
import { canOwnMediaText } from "@/lib/feature-access"

import { useCallback, useEffect, useRef, useState } from "react"
import { getFormatMeta, setFormatMeta } from "@/lib/timing-storage"
import type { CaptionPosition } from "@/components/image-caption-block"

/**
 * The caption on a carousel the user brought — the engine behind the control.
 *
 * It lives here rather than in the media panel because the control does not
 * (Hani, 2026-08-13). Placement is judged on the finished carousel, so the
 * switch and the three positions sit on the carousel's card on the canvas,
 * next to the slides. The panel still runs the import, and the import has to
 * caption the same way, so the shared parts — the two slide caches, the
 * per-slide render call, the Drive pull — are here where both can reach them.
 */

/**
 * The slides exactly as they came out of Drive, before any caption was burned
 * in, keyed by post. Moving the caption redraws from THESE, so a change is one
 * render per slide rather than a second download of every file — and so a
 * caption can never stack on top of itself.
 */
export const carouselBareSlides = new Map<string, string[]>()

/**
 * The captioned render of the same slides. Held alongside the originals so
 * "with caption / without" is a switch between two sets we already have,
 * never a re-render — the same reason the image post keeps the original URL
 * next to the captioned one.
 */
export const carouselCaptionedSlides = new Map<string, string[]>()

export function forgetCarouselSlides(postId: string) {
  carouselBareSlides.delete(postId)
  carouselCaptionedSlides.delete(postId)
}

/**
 * Burn one slide's own words into the picture the user brought.
 *
 * A slide that fails to caption keeps the bare picture rather than failing the
 * whole set: a bare slide is recoverable, a dead import — or a carousel half
 * at the top and half at the bottom — is not.
 */
export async function captionCarouselSlide(
  postId: string,
  bare: string,
  slideIndex: number,
  position: CaptionPosition,
): Promise<string> {
  // A video slide keeps its own frame — the caption is burned into pictures only.
  if (isVideoSlide(bare)) return bare
  // A stored picture of hers (own-media-text): rendered from its URL, stored,
  // with a caption record — so it can be moved / taken off after a reload.
  if (isHttp(bare)) return (await captionOwnSlide(postId, bare, slideIndex, position)).url
  try {
    const res = await fetch("/api/media/caption-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        postId,
        format: "carousel",
        imageBase64: bare,
        slideIndex,
        position,
        persist: false,
      }),
    })
    const data = await res.json()
    if (res.ok && data.image) return data.image as string
  } catch {
    // Same fall-back as a non-OK response: keep the bare slide.
  }
  return bare
}

const isHttp = (s: string | null | undefined): s is string => !!s && /^https?:\/\//i.test(s)

export type OwnSlideCaption = { url: string; status: "captioned" | "no_script" | "failed" }

/**
 * One slide of HER carousel, captioned with the script's slide (own-media-
 * text, Hani only): the picture is already in storage, the render is stored
 * too, and its caption record points back at the bare picture. A slide the
 * script has no text for, or whose render failed, stays the bare picture —
 * and the caller is told which, so it never reports a caption that isn't there.
 */
export async function captionOwnSlide(
  postId: string,
  bareUrl: string,
  slideIndex: number,
  position: CaptionPosition,
): Promise<OwnSlideCaption> {
  if (isVideoSlide(bareUrl)) return { url: bareUrl, status: "captioned" }
  try {
    const res = await fetch("/api/media/caption-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        postId,
        format: "carousel",
        sourceUrl: bareUrl,
        slideIndex,
        position,
        persist: false,
        store: true,
        // The set decides about designed-in words once, from its cover.
        force: true,
      }),
    })
    const data = (await res.json().catch(() => ({}))) as { url?: string; skipped?: string }
    if (res.ok && data.url) return { url: data.url, status: "captioned" }
    if (data.skipped === "no_script_text") return { url: bareUrl, status: "no_script" }
  } catch {
    // Kept bare, reported as failed.
  }
  return { url: bareUrl, status: "failed" }
}

/** The caption record beside a render (lib/caption-record), read from the public bucket. */
export async function readCaptionRecordClient(renderUrl: string): Promise<CaptionRecord | null> {
  if (!/\/storage\/v1\/object\/public\/user-media\//.test(renderUrl)) return null
  try {
    const clean = renderUrl.split(/[?#]/)[0]
    const res = await fetch(`${clean}.json`, { cache: "no-store" })
    if (!res.ok) return null
    const rec = (await res.json()) as CaptionRecord
    return rec?.v === 1 && typeof rec.sourceUrl === "string" ? rec : null
  } catch {
    return null
  }
}

/**
 * The originals under a stored set, from the caption records — no Drive
 * round trip, and it works after a reload (the memory caches don't). A slide
 * we never captioned IS its original. null when a captioned slide has no
 * record (an older render): the caller falls back to Drive.
 */
export async function baresFromRecords(images: string[]): Promise<string[] | null> {
  if (!images.length || !images.every(isHttp)) return null
  const out = await Promise.all(
    images.map(async (u) => {
      if (isVideoSlide(u)) return u
      const rec = await readCaptionRecordClient(u)
      if (rec) return rec.sourceUrl
      return /\/image\/captioned-/.test(u) ? null : u
    }),
  )
  return out.every((u): u is string => !!u) ? out : null
}

/**
 * A set the panel has already saved itself (awaited, before the AI edit
 * reads it) — the page's autosave skips it rather than writing the same
 * slides a second time while the edit is reading them.
 */
const savedSets = new Map<string, string>()
/** Record a set as already on the server (just loaded, or saved by an edit). */
export function markCarouselSaved(postId: string, images: string[]) {
  savedSets.set(postId, images.join("|"))
}
export function isCarouselAlreadySaved(postId: string, images: string[] | null): boolean {
  const s = savedSets.get(postId)
  return !!s && !!images && s === images.join("|")
}

/** Save her carousel now and wait for it: the slides, what it is, and one link per slide. */
export async function saveOwnCarousel(
  postId: string,
  slides: string[],
  links: string[],
  bakedText: boolean | undefined,
): Promise<boolean> {
  try {
    const res = await fetch(`/api/core-posts/${postId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        carouselImages: slides,
        carouselMeta: { source: "import", ...(bakedText === undefined ? {} : { bakedText }) },
        // No Drive slide at all: no links — never stale ones from an older set.
        carouselDriveLinks: links.some(Boolean) ? links : [],
      }),
    })
    if (!res.ok) return false
    savedSets.set(postId, slides.join("|"))
    setFormatMeta(postId, "carousel", { templateId: undefined, bakedText })
    return true
  } catch {
    return false
  }
}

/**
 * Whether the page keeps a loaded carousel as its stored URLs instead of
 * turning it into bytes: her own set, for the own-media-text gate only.
 */
export async function keepCarouselAsUrls(urls: string[], links: unknown): Promise<boolean> {
  const aligned = Array.isArray(links) ? links.filter((l): l is string => typeof l === "string") : null
  if (!isOwnCarousel(urls, aligned)) return false
  try {
    const { data } = await getCurrentUser(createClient())
    return canOwnMediaText(data.user?.email)
  } catch {
    return false
  }
}

export async function urlToBase64(url: string): Promise<string | null> {
  try {
    const blob = await (await fetch(url)).blob()
    return await new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""))
      r.onerror = () => reject(new Error("read"))
      r.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

/** One of her files put in storage as a slide, bare. */
export type StagedSlide = { url: string; base64?: string; link: string; video: boolean }

/**
 * Her file → a stored slide, uncaptioned: a picture into her storage
 * (`slots/`), a clip into a carousel video slide (as it is, 4:5). `link` is
 * the Drive link the slide came from, "" from her computer — so the links
 * always line up with the slides, and a stale link can never be taken for
 * this slide's original.
 */
export async function stageOwnSlide(
  postId: string,
  item: AsIsItem,
): Promise<{ ok: true; slide: StagedSlide } | { ok: false; message: string }> {
  if (item.kind === "video") {
    const v = await makeCarouselVideoSlide({ postId, drive: item.drive, file: item.file })
    return v.ok ? { ok: true, slide: { url: v.url, link: item.drive ?? "", video: true } } : { ok: false, message: v.message }
  }
  if (item.file) {
    const url = await uploadSlotPicture(item.file)
    return url ? { ok: true, slide: { url, link: "", video: false } } : { ok: false, message: "העלאת התמונה נכשלה. נסו שוב." }
  }
  if (item.drive) {
    const res = await fetch("/api/media/from-drive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: item.drive, store: false }),
    })
    const data = (await res.json().catch(() => ({}))) as { base64?: string; error?: string; contentType?: string }
    // A clip behind the link: a VIDEO slide, as it is.
    if (data.error === "not_an_image") return stageOwnSlide(postId, { kind: "video", drive: item.drive })
    if (!res.ok || !data.base64) {
      return {
        ok: false,
        message:
          data.error === "drive_not_public"
            ? "הקובץ בדרייב לא פתוח לצפייה. שתפו אותו לכל מי שיש לו את הקישור."
            : data.error === "file_too_large"
              ? "הקובץ בדרייב גדול מדי."
              : "טעינת הקובץ מהדרייב נכשלה.",
      }
    }
    const url = await uploadSlotPicture(`data:${data.contentType || "image/png"};base64,${data.base64}`)
    return url
      ? { ok: true, slide: { url, base64: data.base64, link: item.drive, video: false } }
      : { ok: false, message: "שמירת התמונה מהדרייב נכשלה. נסו שוב." }
  }
  return { ok: false, message: "לא נמצא קובץ." }
}

export type OwnCaptionOutcome = { slides: string[]; noScript: number[]; failed: number[] }

/**
 * Caption the given slides of her set with the script (side by side — each
 * slide is its own render). `at` = which slides (0-based); the rest untouched.
 */
export async function captionOwnSlides(
  postId: string,
  bares: string[],
  at: number[],
  position: CaptionPosition,
  onProgress?: (msg: string) => void,
): Promise<OwnCaptionOutcome> {
  const slides = [...bares]
  const noScript: number[] = []
  const failed: number[] = []
  const todo = at.filter((i) => i >= 0 && i < bares.length && !isVideoSlide(bares[i]))
  let done = 0
  if (todo.length) onProgress?.(`שמים את הטקסט מהסקריפט על השקופיות (0 מתוך ${todo.length})...`)
  await Promise.all(
    todo.map(async (i) => {
      const r = await captionOwnSlide(postId, bares[i], i, position)
      slides[i] = r.url
      if (r.status === "no_script") noScript.push(i)
      if (r.status === "failed") failed.push(i)
      onProgress?.(`שמים את הטקסט מהסקריפט על השקופיות (${++done} מתוך ${todo.length})...`)
    }),
  )
  return { slides, noScript: noScript.sort((a, b) => a - b), failed: failed.sort((a, b) => a - b) }
}

/** What actually happened to the caption — said plainly, never "done" over a bare slide. */
export function ownCaptionNote(o: { noScript: number[]; failed: number[] }): string {
  const list = (n: number[]) => n.map((i) => i + 1).join(", ")
  const parts: string[] = []
  if (o.noScript.length) {
    parts.push(
      o.noScript.length === 1
        ? `לשקופית ${list(o.noScript)} אין טקסט בסקריפט, אז לא שמתי עליה טקסט.`
        : `לשקופיות ${list(o.noScript)} אין טקסט בסקריפט, אז לא שמתי עליהן טקסט.`,
    )
  }
  if (o.failed.length) {
    parts.push(
      o.failed.length === 1
        ? `הטקסט לא נכנס על שקופית ${list(o.failed)}, היא נשארה כמו שהעליתם. אפשר לנסות שוב מהכרטיס.`
        : `הטקסט לא נכנס על שקופיות ${list(o.failed)}, הן נשארו כמו שהעליתם. אפשר לנסות שוב מהכרטיס.`,
    )
  }
  return parts.join(" ")
}

/** Pull the slides down from their per-slide Drive links, uncaptioned. */
export async function pullBareSlidesFromDrive(
  links: string[],
  onProgress?: (msg: string) => void,
  /** The set as saved: a VIDEO slide there is kept as it is, not pulled as a picture. */
  current?: string[] | null,
): Promise<string[] | null> {
  const slides: string[] = []
  for (let i = 0; i < links.length; i++) {
    if (isVideoSlide(current?.[i])) {
      slides.push(current![i])
      continue
    }
    onProgress?.(`טוען שקופית ${i + 1} מתוך ${links.length}...`)
    const res = await fetch("/api/media/from-drive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: links[i], store: false }),
    })
    const data = await res.json()
    if (!res.ok || data.error || !data.base64) return null
    slides.push(data.base64 as string)
  }
  return slides
}

/**
 * Whether a slide already has its words designed in. Asked of the cover only:
 * a carousel is one design, so its cover speaks for the set. null = couldn't
 * tell (no Anthropic key, model error) — callers keep the old behaviour.
 */
export async function slideHasBakedText(imageBase64: string): Promise<boolean | null> {
  // The rule (Hani, 2026-11-12): her media ALWAYS gets the script's text.
  // Text already on her pictures is hers to avoid ("אנחנו רק נוסיף טקסט"
  // says so up front) — no more guessing, which once skipped a whole set.
  if (ALWAYS_CAPTION_OWN_MEDIA) return false
  try {
    const res = await fetch("/api/media/has-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64 }),
    })
    const data = await res.json()
    return typeof data.hasText === "boolean" ? data.hasText : null
  } catch {
    return null
  }
}

/** Her media always gets the script's text — see slideHasBakedText. */
export const ALWAYS_CAPTION_OWN_MEDIA = true
/** An older post marked "has its own text" is captioned like any other now. */
export const bakedOf = (b: boolean | undefined): boolean | undefined => (ALWAYS_CAPTION_OWN_MEDIA && b ? false : b)

/**
 * What the carousel IS, as the post stores it — made here by the AI (and from
 * which template) or brought by her, and whether her slides carry their own
 * words. Saved with the slides (media_assets.metadata) so it survives another
 * browser or a cleared cache; localStorage alone used to make an AI carousel
 * look "brought" anywhere but where it was made.
 */
export type CarouselStoredMeta = {
  source: "ai" | "import"
  templateId?: string
  bakedText?: boolean
}

export function carouselMetaForServer(postId: string): CarouselStoredMeta {
  const meta = getFormatMeta(postId, "carousel")
  if (meta.templateId) return { source: "ai", templateId: meta.templateId }
  return meta.bakedText === undefined
    ? { source: "import" }
    : { source: "import", bakedText: meta.bakedText }
}

/** The post's stored answer wins over whatever this browser remembered. */
export function applyCarouselMetaFromServer(postId: string, meta: unknown) {
  if (!meta || typeof meta !== "object") return
  const m = meta as Partial<CarouselStoredMeta>
  if (m.source === "ai") {
    setFormatMeta(postId, "carousel", {
      templateId: typeof m.templateId === "string" ? m.templateId : undefined,
      bakedText: undefined,
    })
  } else if (m.source === "import") {
    setFormatMeta(postId, "carousel", {
      templateId: undefined,
      bakedText: typeof m.bakedText === "boolean" ? bakedOf(m.bakedText) : undefined,
    })
  }
}

/** Save the carousel's meta alone, onto the slides already stored. Resolves false when it didn't save. */
export function persistCarouselMeta(postId: string): Promise<boolean> {
  return fetch(`/api/core-posts/${postId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ carouselMeta: carouselMetaForServer(postId) }),
  })
    .then((res) => {
      if (!res.ok) console.error("[carousel-caption][meta]", res.status)
      return res.ok
    })
    .catch((err) => {
      console.error("[carousel-caption][meta]", err)
      return false
    })
}

/** The current on/off + placement for a post, straight from storage. */
export function readCarouselCaptionSettings(postId: string | null): {
  captionOn: boolean
  position: CaptionPosition
} {
  if (!postId || typeof window === "undefined") {
    return { captionOn: true, position: "bottom" }
  }
  const meta = getFormatMeta(postId, "carousel")
  return {
    // Defaults to on: attaching a picture IS the instruction to caption it,
    // which is the contract every other media surface already has.
    captionOn: meta.captionOn ?? true,
    position: meta.captionPosition ?? "bottom",
  }
}

export type CarouselCaptionControls = {
  /** False when there is nothing this control could act on. */
  available: boolean
  /** The slides to DISPLAY — a redraw in progress, otherwise the post's. */
  slides: string[]
  captionOn: boolean
  position: CaptionPosition
  setCaptionOn: (on: boolean) => void
  setPosition: (p: CaptionPosition) => void
  busy: boolean
  progress: string
}

/**
 * Drive the caption on a carousel the user brought.
 *
 * `focusIndex` is the slide currently on screen: it is redrawn FIRST and each
 * slide appears the moment it finishes, so the caption visibly moves on the
 * slide in front of her instead of after the last render.
 */
export function useCarouselCaption({
  postId,
  images,
  onImagesChange,
  driveLinks,
  focusIndex = 0,
}: {
  postId: string | null
  images: string[] | null
  onImagesChange: (imgs: string[]) => void
  driveLinks: string[] | null
  focusIndex?: number
}): CarouselCaptionControls {
  const [settings, setSettings] = useState(() =>
    readCarouselCaptionSettings(postId),
  )
  // Her own media + the script's text (lib/feature-access) — Hani only.
  const own = useOwnMediaText() === true
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState("")
  /**
   * A redraw in flight, shown while it runs.
   *
   * Deliberately NOT pushed through `onImagesChange` slide by slide: that is
   * the page's carousel state, and the page autosaves the whole set whenever
   * it changes — so committing per slide would PATCH every slide's bytes once
   * per render. The post changes once, when the redraw finishes.
   */
  const [draft, setDraft] = useState<string[] | null>(null)
  // A carousel generated from a template draws its own text into the design,
  // so there is no caption on it to switch off or move. Tracked as state, not
  // read inline, because importing or generating flips it while this is
  // mounted — timing-storage fires a synthetic `storage` event on every write.
  const [isImport, setIsImport] = useState(
    () => !!postId && !getFormatMeta(postId, "carousel").templateId,
  )
  // Slides she brought with their words already designed in — nothing to
  // caption, so no caption controls (Hani, 2026-10-22).
  const [bakedText, setBakedText] = useState<boolean | undefined>(() =>
    postId ? bakedOf(getFormatMeta(postId, "carousel").bakedText) : undefined,
  )

  useEffect(() => {
    if (!postId) return
    const sync = () => {
      const meta = getFormatMeta(postId, "carousel")
      setIsImport(!meta.templateId)
      setBakedText(bakedOf(meta.bakedText))
      setSettings(readCarouselCaptionSettings(postId))
    }
    sync()
    window.addEventListener("storage", sync)
    return () => window.removeEventListener("storage", sync)
  }, [postId])

  const slideCount = images?.length ?? 0
  const links = (driveLinks ?? []).filter(Boolean)
  // Saved links alone don't make the slides hers: links can be pasted onto a
  // post whose carousel the AI made (Hani's 5-slide AI carousel carried two
  // links nobody imported, and grew caption controls). An import produces
  // one slide per link, so the counts have to agree.
  const cachedBares = postId ? carouselBareSlides.get(postId) : undefined
  const cameFromImport =
    slideCount > 0 &&
    (links.length === slideCount ||
      cachedBares?.length === slideCount ||
      // Her pictures from the computer / the chat have no links (own-media-text).
      (own && isOwnCarousel(images ?? [], driveLinks)))

  // A carousel brought before the check existed has never been looked at.
  // Look once, at the cover AS SHE BROUGHT IT — the stored slide may carry
  // our own caption, which would read as "already has text". The answer is
  // saved with the post, so this runs once per carousel, not per visit.
  const checkedRef = useRef<string | null>(null)
  // Couldn't tell (no key, model down): behave as before the check existed.
  const [checkFailed, setCheckFailed] = useState(false)
  useEffect(() => setCheckFailed(false), [postId])
  useEffect(() => {
    if (!postId || !isImport || !cameFromImport || bakedText !== undefined) return
    if (checkedRef.current === postId) return
    const cachedCover = cachedBares?.[0]
    checkedRef.current = postId
    void (async () => {
      let cover = cachedCover
      if (!cover && own && images) {
        const bares = await baresFromRecords(images.slice(0, 1))
        cover = bares?.[0]
      }
      if (!cover && links.length) {
        const pulled = await pullBareSlidesFromDrive(links.slice(0, 1))
        cover = pulled?.[0]
      }
      // A stored picture (own-media-text) is looked at as bytes.
      if (cover && isHttp(cover)) cover = (await urlToBase64(cover)) ?? undefined
      const hasText = cover ? await slideHasBakedText(cover) : null
      if (hasText === null) {
        setCheckFailed(true)
        return
      }
      setFormatMeta(postId, "carousel", { bakedText: hasText })
      const saved = await persistCarouselMeta(postId)
      if (!saved && own) toast.error("לא הצלחתי לשמור את הגדרות הקרוסלה. רעננו ונסו שוב.")
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId, isImport, cameFromImport, bakedText, links.join("|")])

  /** The originals, from the cache or — after a reload wiped it — from Drive. */
  const getBares = useCallback(async (): Promise<string[] | null> => {
    if (!postId) return null
    const cached = carouselBareSlides.get(postId)
    if (cached && cached.length === slideCount) return cached
    // After a reload (own-media-text): the originals from the caption
    // records — not a Drive download, and never links that may be stale.
    if (own && images) {
      const fromRecords = await baresFromRecords(images)
      if (fromRecords) {
        carouselBareSlides.set(postId, fromRecords)
        return fromRecords
      }
    }
    if (links.length === 0 || (own && links.length !== slideCount)) return null
    setProgress("טוענים מחדש את השקופיות מהדרייב...")
    const pulled = await pullBareSlidesFromDrive(links, setProgress, images)
    if (pulled) carouselBareSlides.set(postId, pulled)
    return pulled
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId, slideCount, links.join("|"), own, (images ?? []).join("|")])

  /** Redraw the whole set at `position`, starting with the visible slide. */
  const redraw = useCallback(
    async (bares: string[], position: CaptionPosition): Promise<boolean> => {
      if (!postId) return false
      const order = [
        focusIndex,
        ...bares.map((_, i) => i).filter((i) => i !== focusIndex),
      ].filter((i) => i >= 0 && i < bares.length)

      const redrawn = [...bares]
      let done = 0
      for (const i of order) {
        setProgress(`מזיזים את הכיתוב — ${++done} מתוך ${bares.length}...`)
        redrawn[i] = await captionCarouselSlide(postId, bares[i], i, position)
        // A copy per step so the card re-renders on the slide that just
        // finished; mutating the array it already holds would not.
        setDraft([...redrawn])
      }
      carouselCaptionedSlides.set(postId, redrawn)
      onImagesChange(redrawn)
      setDraft(null)
      return true
    },
    [postId, focusIndex, onImagesChange],
  )

  const setPosition = useCallback(
    async (next: CaptionPosition) => {
      if (!postId || busy || next === settings.position) return
      const previous = settings.position
      setSettings((s) => ({ ...s, position: next }))
      setFormatMeta(postId, "carousel", { captionPosition: next })
      if (slideCount === 0) return
      // The picker is disabled while the caption is off; belt and braces, the
      // stored render is no longer the one this position asks for, so turning
      // the caption back on has to draw a fresh one rather than restore it.
      if (!settings.captionOn) {
        carouselCaptionedSlides.delete(postId)
        return
      }
      setBusy(true)
      try {
        const bares = await getBares()
        // Nothing to redraw from. Snapping the control back is the honest
        // answer: leaving it on "top" over slides still captioned at the
        // bottom would be the card lying about what the post looks like.
        if (!bares || !(await redraw(bares, next))) {
          setSettings((s) => ({ ...s, position: previous }))
          setFormatMeta(postId, "carousel", { captionPosition: previous })
        }
      } catch (err) {
        console.error("[carousel-caption][position]", err)
        setDraft(null)
        setSettings((s) => ({ ...s, position: previous }))
        setFormatMeta(postId, "carousel", { captionPosition: previous })
      } finally {
        setBusy(false)
        setProgress("")
      }
    },
    [postId, busy, settings, slideCount, getBares, redraw],
  )

  const setCaptionOn = useCallback(
    async (on: boolean) => {
      if (!postId || busy || on === settings.captionOn) return
      setSettings((s) => ({ ...s, captionOn: on }))
      setFormatMeta(postId, "carousel", { captionOn: on })
      if (slideCount === 0) return
      const revert = () => {
        setDraft(null)
        setSettings((s) => ({ ...s, captionOn: !on }))
        setFormatMeta(postId, "carousel", { captionOn: !on })
      }
      setBusy(true)
      try {
        if (!on) {
          const bares = await getBares()
          if (bares) onImagesChange(bares)
          else revert()
          return
        }
        const captioned = carouselCaptionedSlides.get(postId)
        if (captioned && captioned.length === slideCount) {
          onImagesChange(captioned)
          return
        }
        const bares = await getBares()
        if (!bares || !(await redraw(bares, settings.position))) revert()
      } catch (err) {
        console.error("[carousel-caption][toggle]", err)
        revert()
      } finally {
        setBusy(false)
        setProgress("")
      }
    },
    [postId, busy, settings, slideCount, getBares, redraw, onImagesChange],
  )

  return {
    // The links are the gate, not just the missing template id: a carousel
    // from before this feature has no stored template id either, and offering
    // to move a caption onto slides whose text is already baked into the
    // design would ruin them. No links and no originals means no way to act,
    // so there is nothing to offer.
    available:
      !!postId &&
      isImport &&
      // Hidden until the cover has been looked at, so the controls never
      // flash on and vanish over a finished design.
      cameFromImport &&
      (bakedText === false || (bakedText === undefined && checkFailed)),
    slides: draft ?? images ?? [],
    captionOn: settings.captionOn,
    position: settings.position,
    setCaptionOn,
    setPosition,
    busy,
    progress,
  }
}
