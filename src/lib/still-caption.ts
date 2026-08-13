"use client"

import { useCallback, useEffect, useState } from "react"
import { getFormatMeta, setFormatMeta } from "@/lib/timing-storage"
import type { CaptionPosition } from "@/components/image-caption-block"

/**
 * The caption on a STILL the user brought — the engine behind the control on
 * the image post's card and on the b-roll's.
 *
 * The carousel's sibling (`lib/carousel-caption`), and deliberately separate:
 * a carousel is a set of base64 slides the panel holds in memory, a still is
 * ONE file that lives in storage and whose captioned render replaces it
 * there. Same decision for the user, different plumbing underneath.
 *
 * A b-roll still is the same shape as a feed image — one file, one render,
 * one storage slot — and only differs in the canvas it is drawn on (9:16
 * rather than 4:5) and which format's words go on it. Both are handled by the
 * caption route, so both are handled here.
 */

/** The captioned render per (post, format), so switching back on doesn't redraw it. */
const captionedImages = new Map<string, string>()
const cacheKey = (postId: string, format: StillCaptionFormat) =>
  `${postId}:${format}`

export type StillCaptionFormat = "image_post" | "b_roll"

export type StillCaptionControls = {
  available: boolean
  captionOn: boolean
  position: CaptionPosition
  setCaptionOn: (on: boolean) => void
  setPosition: (p: CaptionPosition) => void
  busy: boolean
  progress: string
}

export function useStillCaption({
  postId,
  format,
  url,
  onUrlChange,
}: {
  postId: string | null
  format: StillCaptionFormat
  /** The picture the post currently uses for this format. */
  url: string | null
  onUrlChange: (url: string) => void
}): StillCaptionControls {
  const read = useCallback(() => {
    if (!postId || typeof window === "undefined") {
      return { captionOn: true, position: "bottom" as CaptionPosition, source: undefined }
    }
    const meta = getFormatMeta(postId, format)
    return {
      captionOn: meta.captionOn ?? true,
      position: meta.captionPosition ?? "bottom",
      source: meta.captionSourceUrl,
    }
  }, [postId, format])

  const [settings, setSettings] = useState(read)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState("")

  // The panel records the original the moment a caption lands, and
  // timing-storage fires a synthetic `storage` event on every write — so a
  // picture uploaded while this card is on screen arms the control without a
  // reload.
  useEffect(() => {
    if (!postId) return
    const sync = () => setSettings(read())
    sync()
    window.addEventListener("storage", sync)
    return () => window.removeEventListener("storage", sync)
  }, [postId, read])

  /** Make `next` the picture the POST uses, not just the one on screen. */
  const applyUrl = useCallback(
    async (next: string) => {
      if (!postId) return
      onUrlChange(next)
      try {
        await fetch(`/api/core-posts/${postId}/media`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            format,
            url: next,
            assetType: "image",
          }),
        })
      } catch (err) {
        console.error("[still-caption][apply]", err)
      }
    },
    [postId, format, onUrlChange],
  )

  /** Draw the post's words over the original at `position`. */
  const render = useCallback(
    async (source: string, position: CaptionPosition): Promise<string | null> => {
      if (!postId) return null
      setProgress("מטמיעים את הכיתוב בתמונה...")
      try {
        const res = await fetch("/api/media/caption-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Always from the ORIGINAL, never from what is on screen — the
          // route falls back to the format's stored image, which after the
          // first caption IS the captioned one, and that would stack.
          body: JSON.stringify({
            postId,
            format,
            sourceUrl: source,
            position,
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.url) return null
        captionedImages.set(cacheKey(postId, format), data.url as string)
        return data.url as string
      } catch (err) {
        console.error("[still-caption][render]", err)
        return null
      } finally {
        setProgress("")
      }
    },
    [postId, format],
  )

  const setPosition = useCallback(
    async (next: CaptionPosition) => {
      if (!postId || busy || next === settings.position) return
      const previous = settings.position
      setSettings((s) => ({ ...s, position: next }))
      setFormatMeta(postId, format, { captionPosition: next })
      if (!settings.source) return
      if (!settings.captionOn) {
        // The stored render is no longer the one this position asks for.
        captionedImages.delete(cacheKey(postId, format))
        return
      }
      setBusy(true)
      try {
        const drawn = await render(settings.source, next)
        // Snapping back is the honest answer to a render that failed: leaving
        // the control on "top" over a picture still captioned at the bottom
        // would be the card lying about what the post looks like.
        if (drawn) await applyUrl(drawn)
        else {
          setSettings((s) => ({ ...s, position: previous }))
          setFormatMeta(postId, format, { captionPosition: previous })
        }
      } finally {
        setBusy(false)
      }
    },
    [postId, format, busy, settings, render, applyUrl],
  )

  const setCaptionOn = useCallback(
    async (on: boolean) => {
      if (!postId || busy || on === settings.captionOn) return
      setSettings((s) => ({ ...s, captionOn: on }))
      setFormatMeta(postId, format, { captionOn: on })
      const source = settings.source
      if (!source) return
      setBusy(true)
      try {
        if (!on) {
          // The picture exactly as she brought it becomes the post's again.
          await applyUrl(source)
          return
        }
        const cached = captionedImages.get(cacheKey(postId, format))
        if (cached) {
          await applyUrl(cached)
          return
        }
        const drawn = await render(source, settings.position)
        if (drawn) await applyUrl(drawn)
        else {
          setSettings((s) => ({ ...s, captionOn: false }))
          setFormatMeta(postId, format, { captionOn: false })
        }
      } finally {
        setBusy(false)
      }
    },
    [postId, format, busy, settings, render, applyUrl],
  )

  return {
    // Without the original there is nothing to draw over and nothing to fall
    // back to, so there is no control to offer. It is recorded the moment a
    // picture is captioned; an AI-generated image post never has one, and
    // correctly gets no control.
    available: !!postId && !!url && !!settings.source,
    captionOn: settings.captionOn,
    position: settings.position,
    setCaptionOn,
    setPosition,
    busy,
    progress,
  }
}
