"use client"

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import {
  subscribeBRollGeneration,
  getBRollGenerationSnapshot,
} from "@/lib/broll-generation-store"
import {
  subscribeGeneration,
  getGenerationSnapshot,
} from "@/lib/image-generation-store"
import {
  subscribeStoryGeneration,
  getStoryGenerationSnapshot,
} from "@/lib/story-generation-store"
import { getFormatMeta, type FormatId } from "@/lib/timing-storage"

/**
 * Which formats are making media right now, for the canvas skeleton cards.
 *
 * Two sources, because the work lives in two places:
 *   • the module stores (AI story / image / b-roll, caption burns, the story
 *     Drive import) — read here directly, so the skeleton stays up after the
 *     media panel closes, which is exactly when that work keeps going;
 *   • the panel itself (uploads, Drive pulls, talking-head renders, carousel
 *     generation) — reported through `onPanelBusyChange`.
 *
 * It also lands store results on the canvas. The panel used to be the only
 * thing listening, so anything that finished while it was closed showed no
 * card until it was reopened — and a skeleton that ends in nothing reads as
 * "it failed". Only CHANGES are picked up: a result the store kept from
 * earlier in the session may have been deleted or replaced since.
 */
export function useFormatMediaBusy(
  postId: string | null,
  setters: {
    onStoryImages: (frames: string[]) => void
    onStoryVideoUrl: (url: string) => void
    onImagePostUrl: (url: string) => void
    onBRollUrl: (url: string) => void
  },
) {
  const key = postId ?? ""

  const story = useSyncExternalStore(
    useCallback((cb: () => void) => subscribeStoryGeneration(key, cb), [key]),
    useCallback(() => getStoryGenerationSnapshot(key), [key]),
    useCallback(() => getStoryGenerationSnapshot(key), [key]),
  )
  const image = useSyncExternalStore(
    useCallback((cb: () => void) => subscribeGeneration(key, cb), [key]),
    useCallback(() => getGenerationSnapshot(key), [key]),
    useCallback(() => getGenerationSnapshot(key), [key]),
  )
  const bRoll = useSyncExternalStore(
    useCallback((cb: () => void) => subscribeBRollGeneration(postId, cb), [postId]),
    useCallback(() => getBRollGenerationSnapshot(postId), [postId]),
    useCallback(() => getBRollGenerationSnapshot(postId), [postId]),
  )

  const [panelBusy, setPanelBusy] = useState<Record<string, boolean>>({})
  const onPanelBusyChange = useCallback((format: string, busy: boolean) => {
    setPanelBusy((prev) => (!!prev[format] === busy ? prev : { ...prev, [format]: busy }))
  }, [])

  // `setters` are the page's useState setters — stable, so the effects
  // below can read them without re-running on every render.
  const { onStoryImages, onStoryVideoUrl, onImagePostUrl, onBRollUrl } = setters

  useOnChange(story.saved, (frames) => frames && onStoryImages(frames))
  useOnChange(bRoll.storyFrames, (frames) => frames && onStoryImages(frames))
  useOnChange(image.saved, (url) => url && onImagePostUrl(url))
  useOnChange(bRoll.url, (url) => url && onBRollUrl(url))
  useOnChange(bRoll.burned, (burned) => {
    if (!burned) return
    if (burned.format === "b_roll") onBRollUrl(burned.url)
    else if (burned.format === "story") onStoryVideoUrl(burned.url)
  })
  useOnChange(bRoll.captionedImage, (img) => {
    if (!img || !postId) return
    // Same rule the panel follows: "בלי כיתוב" keeps the picture she brought.
    if (getFormatMeta(postId, img.format as FormatId).captionOn === false) return
    if (img.format === "image_post") onImagePostUrl(img.url)
    if (img.format === "b_roll") onBRollUrl(img.url)
  })

  const busy: Record<string, boolean> = {
    talking_head: !!panelBusy.talking_head,
    carousel: !!panelBusy.carousel,
    story:
      story.inFlight > 0 ||
      bRoll.storyImporting ||
      bRoll.burningFormats.includes("story") ||
      !!panelBusy.story,
    b_roll:
      bRoll.inFlight > 0 ||
      bRoll.burningFormats.includes("b_roll") ||
      bRoll.captioningFormats.includes("b_roll") ||
      !!panelBusy.b_roll,
    image_post:
      image.inFlight > 0 ||
      bRoll.captioningFormats.includes("image_post") ||
      !!panelBusy.image_post,
  }

  return { busy, onPanelBusyChange }
}

/**
 * Run `fn` when `value` changes after mount — never for the value at mount.
 * Keyed on `value` alone: `fn` is a fresh closure every render, over setters
 * that never change.
 */
function useOnChange<T>(value: T, fn: (value: T) => void) {
  const prev = useRef(value)
  useEffect(() => {
    if (Object.is(prev.current, value)) return
    prev.current = value
    fn(value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
}
