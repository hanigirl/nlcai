"use client"

import { useCallback, useEffect, useState } from "react"
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

/** Pull the slides down from their per-slide Drive links, uncaptioned. */
export async function pullBareSlidesFromDrive(
  links: string[],
  onProgress?: (msg: string) => void,
): Promise<string[] | null> {
  const slides: string[] = []
  for (let i = 0; i < links.length; i++) {
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

  useEffect(() => {
    if (!postId) return
    const sync = () => {
      setIsImport(!getFormatMeta(postId, "carousel").templateId)
      setSettings(readCarouselCaptionSettings(postId))
    }
    sync()
    window.addEventListener("storage", sync)
    return () => window.removeEventListener("storage", sync)
  }, [postId])

  const slideCount = images?.length ?? 0
  const links = (driveLinks ?? []).filter(Boolean)

  /** The originals, from the cache or — after a reload wiped it — from Drive. */
  const getBares = useCallback(async (): Promise<string[] | null> => {
    if (!postId) return null
    const cached = carouselBareSlides.get(postId)
    if (cached && cached.length === slideCount) return cached
    if (links.length === 0) return null
    setProgress("טוענים מחדש את השקופיות מהדרייב...")
    const pulled = await pullBareSlidesFromDrive(links, setProgress)
    if (pulled) carouselBareSlides.set(postId, pulled)
    return pulled
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId, slideCount, links.join("|")])

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
      slideCount > 0 &&
      (links.length > 0 || !!carouselBareSlides.get(postId)),
    slides: draft ?? images ?? [],
    captionOn: settings.captionOn,
    position: settings.position,
    setCaptionOn,
    setPosition,
    busy,
    progress,
  }
}
