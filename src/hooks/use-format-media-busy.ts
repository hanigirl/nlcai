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
    /** The story's frames as the page shows them — what a reload compares against. */
    storyFrames?: string[] | null
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

  const storyResumed = useStoryGenerationAcrossReload(postId, story.inFlight, setters.storyFrames ?? null, setters.onStoryImages)

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
      storyResumed ||
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

/* ------------------------------------------------------------------ */
/*  An AI story generation outlives a reload                           */
/* ------------------------------------------------------------------ */

/**
 * The story route makes the frames AND saves them to the post on the server
 * (api/story/generate-media), so a reload mid-generation doesn't stop the
 * work — but it wiped the only thing that knew it was running: the in-memory
 * store. The card dropped its skeleton, nothing ever landed, and it looked as
 * if the refresh had stopped the generation (Nataliya, 2026-11-13).
 *
 * So a running generation leaves a note in localStorage (when it started, and
 * the frames the story had then). After a reload the note keeps the story
 * card busy and the post is polled until its story frames change — then the
 * new set lands on the canvas — or until the route's time limit has passed.
 */
const STORY_PENDING_PREFIX = "nlcai:story-gen-pending:"
/** The route's maxDuration (300s) plus the save and some slack. */
const STORY_PENDING_MAX_MS = 6 * 60_000
const STORY_POLL_MS = 5_000

type StoryPending = { startedAt: number; before: string }

const framesSig = (frames: string[] | null | undefined) => (frames ?? []).join("|")

function readStoryPending(postId: string): StoryPending | null {
  try {
    const raw = localStorage.getItem(STORY_PENDING_PREFIX + postId)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<StoryPending>
    return typeof p.startedAt === "number" && typeof p.before === "string" ? { startedAt: p.startedAt, before: p.before } : null
  } catch {
    return null
  }
}

function writeStoryPending(postId: string, p: StoryPending | null) {
  try {
    if (p) localStorage.setItem(STORY_PENDING_PREFIX + postId, JSON.stringify(p))
    else localStorage.removeItem(STORY_PENDING_PREFIX + postId)
  } catch {
    // Private mode / blocked storage: the generation itself is unaffected.
  }
}

function useStoryGenerationAcrossReload(
  postId: string | null,
  inFlight: number,
  storyFrames: string[] | null,
  onStoryImages: (frames: string[]) => void,
): boolean {
  const framesRef = useRef(storyFrames)
  const landRef = useRef(onStoryImages)
  useEffect(() => {
    framesRef.current = storyFrames
    landRef.current = onStoryImages
  })

  // This page's own generations: note on start, clear when they all end here.
  const prevInFlight = useRef(0)
  useEffect(() => {
    const prev = prevInFlight.current
    prevInFlight.current = inFlight
    if (!postId) return
    if (inFlight > 0 && prev === 0) writeStoryPending(postId, { startedAt: Date.now(), before: framesSig(framesRef.current) })
    else if (inFlight === 0 && prev > 0) writeStoryPending(postId, null)
  }, [postId, inFlight])

  // After a reload: a note left by a generation this page didn't see end.
  const [resumed, setResumed] = useState(false)
  useEffect(() => {
    if (!postId) return
    const pending = readStoryPending(postId)
    if (!pending) return
    // A generation running in THIS page already shows busy and clears its own note.
    if (prevInFlight.current > 0) return
    if (Date.now() - pending.startedAt > STORY_PENDING_MAX_MS) {
      writeStoryPending(postId, null)
      return
    }
    let stopped = false
    // Two polls in a row with the same new set — never a set caught mid-save.
    let candidate: string | null = null
    const stop = () => {
      stopped = true
      clearInterval(timer)
      writeStoryPending(postId, null)
      setResumed(false)
    }
    const poll = async () => {
      if (stopped) return
      if (Date.now() - pending.startedAt > STORY_PENDING_MAX_MS) {
        stop()
        return
      }
      setResumed(true)
      const res = await fetch(`/api/core-posts/${postId}`).catch(() => null)
      if (stopped || !res?.ok) return
      const data = (await res.json().catch(() => null)) as { post?: { storyImageUrls?: unknown } } | null
      const raw = data?.post?.storyImageUrls
      const urls = Array.isArray(raw) ? raw.filter((u): u is string => typeof u === "string") : []
      const sig = framesSig(urls)
      if (!urls.length || sig === pending.before) {
        candidate = null
        return
      }
      if (candidate !== sig) {
        candidate = sig
        return
      }
      landRef.current(urls)
      stop()
    }
    const timer = setInterval(() => void poll(), STORY_POLL_MS)
    void poll()
    return () => {
      stopped = true
      clearInterval(timer)
      setResumed(false)
    }
  }, [postId])

  return resumed
}
