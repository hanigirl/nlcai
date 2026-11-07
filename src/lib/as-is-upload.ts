"use client"

/**
 * "להעלות כמו שזה, בלי תוספות" (Hani, 2026-11-06): what she attached in the AI
 * panel becomes the format's media exactly as it is — no generation, no
 * style. It goes through the media panel's OWN import (the Drive pull, the
 * computer upload), so the result is the same as "מדיה מוכנה מ Google Drive"
 * always gave: a Drive video stays the video, pictures are copied over.
 *
 * The import code lives in the media panel's format flow (it holds the
 * panel's state), so:
 *   - the AI panel asks: requestAsIsUpload(format, items);
 *   - the project page opens that format's media panel (onAsIsNeedsPanel);
 *   - the flow, once mounted, registers its importer and runs what's waiting.
 *
 * The same bus carries the media panel's "מדיה מוכנה מ Google Drive" shortcut:
 * requestDrivePicker(format) → the next AI panel for it opens with Drive up.
 */

export type AsIsItem = {
  kind: "image" | "video"
  /** A file from her Drive folder: its view link. */
  drive?: string
  /** A file from her computer, as she picked it (a video stays a video). */
  file?: File
}

export type AsIsResult = { ok: true; message: string } | { ok: false; message: string }
/**
 * `forEdit` (Hani, 2026-11-06 — "אם העלתי סרטון תעשה סרטון"): her video is
 * imported so the own-video AI edit can caption it right after — wait until
 * it's saved, and skip the import's own automatic caption.
 */
export type AsIsOptions = {
  forEdit?: boolean
  /** Her words — a carousel video slide's caption design (api/carousel/video-slide). */
  instruction?: string
  /**
   * Carousel slide slots (Hani, 2026-11-06): per item, the slide (0-based)
   * it goes in — replacing what's there; the slide count stays. Without a
   * carousel yet, the items become the slides in slot order.
   */
  at?: number[]
  /**
   * No carousel yet: the slide count it will have. Her files go in their
   * slots and the empty slots are generated with AI (she confirmed) —
   * never a shorter carousel of only her files (live bug, 2026-11-07).
   */
  fill?: number
  /** The carousel's slides right now, when the caller knows them fresher than the panel (just edited). */
  base?: string[]
}
type Importer = (items: AsIsItem[], opts?: AsIsOptions) => Promise<AsIsResult>

const importers = new Map<string, Importer>()
const pending = new Map<string, { items: AsIsItem[]; opts?: AsIsOptions; resolve: (r: AsIsResult) => void }>()
const openers = new Set<(format: string) => void>()

/** The media panel's flow for `format` — `null` on unmount. Runs what's waiting. */
export function registerAsIsImporter(format: string, fn: Importer | null) {
  if (!fn) {
    importers.delete(format)
    return
  }
  importers.set(format, fn)
  const wait = pending.get(format)
  if (wait) {
    pending.delete(format)
    void fn(wait.items, wait.opts).then(wait.resolve, (e) => wait.resolve({ ok: false, message: String(e) }))
  }
}

/** The AI panel: make these the format's media, as they are. */
export function requestAsIsUpload(format: string, items: AsIsItem[], opts?: AsIsOptions): Promise<AsIsResult> {
  const fn = importers.get(format)
  if (fn) return fn(items, opts)
  return new Promise<AsIsResult>((resolve) => {
    pending.set(format, { items, opts, resolve })
    openers.forEach((open) => open(format))
    // The panel never came up (no saved post, a format with no panel): say so.
    setTimeout(() => {
      if (pending.get(format)?.items === items) {
        pending.delete(format)
        resolve({ ok: false, message: "לא הצלחתי לפתוח את פאנל המדיה של הפורמט הזה. פתחו אותו ונסו שוב." })
      }
    }, 8000)
  })
}

/** The project page: open `format`'s media panel when an as-is upload needs it. */
export function onAsIsNeedsPanel(fn: (format: string) => void): () => void {
  openers.add(fn)
  return () => openers.delete(fn)
}

/* -------------------------- "מדיה מוכנה מ Google Drive" → the AI panel's Drive */

let drivePickerFor: string | null = null
const driveListeners = new Set<() => void>()

/** Ask the next AI panel for `format` to open with its Drive gallery up. */
export function requestDrivePicker(format: string) {
  drivePickerFor = format
  driveListeners.forEach((l) => l())
}

/** The AI panel takes the request (once) — true when it was for this format. */
export function takeDrivePickerRequest(format: string): boolean {
  if (drivePickerFor !== format) return false
  drivePickerFor = null
  return true
}

export function onDrivePickerRequest(fn: () => void): () => void {
  driveListeners.add(fn)
  return () => driveListeners.delete(fn)
}
