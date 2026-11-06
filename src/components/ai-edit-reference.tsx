"use client"

import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react"
import { ImagePlus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TooltipLabel } from "@/components/ui/tooltip"
import { MAX_REFERENCES } from "@/lib/ai-edit-references"
import type { AsIsItem } from "@/lib/as-is-upload"
import { cn } from "@/lib/utils"

/**
 * Reference images in a format's "עריכה עם AI" panel (Hani, 2026-10-29): an
 * icon by the composer to attach a screenshot or example, plus paste (⌘V) and
 * drag-and-drop onto the panel. They go with the next message only, so the AI
 * sees what she means ("הכתוביות שייראו ככה") and learns from it.
 *
 * Used by FormatCopyChat (copy) and MediaAiChat (media) — not the core post.
 */

/** Longest side after shrinking. Claude reads up to ~1568px anyway. */
const MAX_SIDE = 1280

/** Matches MAX_DATA_URL_CHARS on the server (lib/ai-edit-references). */
const MAX_PNG_CHARS = 1_400_000

function hasTransparency(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const data = ctx.getImageData(0, 0, w, h).data
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true
  return false
}

/** Any image file → a data URL small enough to send (JPEG; PNG for a cut-out). */
function shrink(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height))
      const canvas = document.createElement("canvas")
      canvas.width = Math.max(1, Math.round(img.width * scale))
      canvas.height = Math.max(1, Math.round(img.height * scale))
      const ctx = canvas.getContext("2d")!
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      // A cut-out (a character or logo on a transparent background) stays a
      // PNG: the media AI edit can place her exact file into the design, and
      // a JPEG would put it in a white box. Only while it fits the per-image
      // cap (lib/ai-edit-references) — otherwise the JPEG below.
      if (file.type !== "image/jpeg" && hasTransparency(ctx, canvas.width, canvas.height)) {
        const png = canvas.toDataURL("image/png")
        if (png.length <= MAX_PNG_CHARS) return resolve(png)
      }
      // Transparency would turn black as JPEG — flatten onto white.
      ctx.globalCompositeOperation = "destination-over"
      ctx.fillStyle = "#fff"
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL("image/jpeg", 0.85))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("bad image"))
    }
    img.src = url
  })
}

function imageFiles(list: FileList | DataTransferItemList | null | undefined): File[] {
  if (!list) return []
  const out: File[] = []
  for (const item of Array.from(list as ArrayLike<File | DataTransferItem>)) {
    const file = item instanceof File ? item : item.kind === "file" ? item.getAsFile() : null
    if (file && file.type.startsWith("image/")) out.push(file)
  }
  return out
}

export function useReferenceImages() {
  const [refs, setRefs] = useState<string[]>([])
  /**
   * The ones that only show a look — a picture pulled from a link
   * (components/ai-edit-link-reference). Everything else is a picture she
   * attached herself, which the first generation puts IN the media (Hani,
   * 2026-11-05: "התמונה תכנס ביצירה הראשונה אם שמתי אותה כרפרנס").
   */
  const [looks, setLooks] = useState<string[]>([])
  /**
   * Where each of her attachments came from, by its preview — so "להעלות כמו
   * שזה, בלי תוספות" (lib/as-is-upload) can make the ORIGINAL the media: the
   * file from her computer (a video stays a video), or the Drive file.
   */
  const [origins, setOrigins] = useState<Record<string, AsIsItem>>({})
  const [dragging, setDragging] = useState(false)
  const refsRef = useRef(refs)
  useEffect(() => {
    refsRef.current = refs
  })

  const add = useCallback(
    async (
      files: File[],
      opts: {
        look?: boolean
        /** Per file (same order): what it stands for, when not the picture itself. */
        origins?: (AsIsItem | undefined)[]
      } = {},
    ) => {
      const room = MAX_REFERENCES - refsRef.current.length
      if (room <= 0 || !files.length) return [] as string[]
      const taken = files.slice(0, room)
      const results = await Promise.all(taken.map((f) => shrink(f).catch(() => null)))
      const shrunk = results.filter((s): s is string => !!s)
      setRefs((prev) => [...prev, ...shrunk].slice(0, MAX_REFERENCES))
      if (opts.look) setLooks((prev) => [...prev, ...shrunk])
      else
        setOrigins((prev) => {
          const next = { ...prev }
          results.forEach((src, i) => {
            if (src) next[src] = opts.origins?.[i] ?? { kind: "image", file: taken[i] }
          })
          return next
        })
      // What was added — the carousel's slide slots put it where she pointed.
      return shrunk
    },
    [],
  )

  const remove = useCallback((i: number) => setRefs((prev) => prev.filter((_, j) => j !== i)), [])
  const clear = useCallback(() => {
    setRefs([])
    setLooks([])
  }, [])
  /** Her own attachments in `list`, as their originals (looks from a link are not hers). */
  const originals = useCallback(
    (list: string[]): AsIsItem[] =>
      list.filter((r) => !looks.includes(r)).flatMap((r) => (origins[r] ? [origins[r]] : [])),
    [looks, origins],
  )
  /** Put sent references back in the tray (a generation that failed). */
  const restore = useCallback((list: string[], lookList: string[] = []) => {
    setRefs(list.slice(0, MAX_REFERENCES))
    setLooks(lookList)
  }, [])
  /** Split for a generation: her own pictures to place, and look-only ones. */
  const split = useCallback(
    (list: string[]) => ({ place: list.filter((r) => !looks.includes(r)), looks: list.filter((r) => looks.includes(r)) }),
    [looks],
  )

  /** On the textarea: ⌘V of a screenshot attaches it; text pastes as usual. */
  const onPaste = useCallback(
    (e: ClipboardEvent) => {
      const files = imageFiles(e.clipboardData?.items)
      if (!files.length) return
      e.preventDefault()
      void add(files)
    },
    [add],
  )

  /** On the panel: drop an image anywhere on it. */
  const dropProps = {
    onDragOver: (e: DragEvent) => {
      if (!Array.from(e.dataTransfer.types).includes("Files")) return
      e.preventDefault()
      setDragging(true)
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
    },
    onDrop: (e: DragEvent) => {
      const files = imageFiles(e.dataTransfer.files)
      setDragging(false)
      if (!files.length) return
      e.preventDefault()
      void add(files)
    },
  }

  return { refs, add, remove, clear, restore, split, originals, onPaste, dropProps, dragging, full: refs.length >= MAX_REFERENCES }
}

export type ReferenceImages = ReturnType<typeof useReferenceImages>

/** The icon by the composer. */
export function ReferenceButton({ r, disabled }: { r: ReferenceImages; disabled?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void r.add(imageFiles(e.target.files))
          e.target.value = ""
        }}
      />
      <TooltipLabel label="הוספת רפרנס (צילום מסך)">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || r.full}
          aria-label="הוספת רפרנס (צילום מסך)"
          // Same footprint as the send button beside it (32px circle, 16px icon, gray hover); the placeholder's colour.
          className="shrink-0 rounded-full text-text-neutral-default hover:bg-gray-95 hover:text-text-neutral-default dark:hover:bg-gray-20"
        >
          <ImagePlus className="size-4" />
        </Button>
      </TooltipLabel>
    </>
  )
}

/** Thumbnails waiting to be sent, above the composer. */
export function ReferenceTray({
  r,
  hide = [],
}: {
  r: ReferenceImages
  /** Shown elsewhere — the carousel's slide slots (components/carousel-slide-slots). */
  hide?: string[]
}) {
  if (!r.refs.some((src) => !hide.includes(src))) return null
  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {r.refs.map((src, i) => hide.includes(src) ? null : (
        <div key={i} className="relative size-14 overflow-hidden rounded-lg border border-border-neutral-default">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={`רפרנס ${i + 1}`} className="size-full object-cover" />
          <button
            type="button"
            onClick={() => r.remove(i)}
            aria-label={`הסרת רפרנס ${i + 1}`}
            className="absolute end-0.5 top-0.5 inline-flex size-5 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
    </div>
  )
}

/** The references a sent message carried, inside her bubble in the thread. */
export function ReferenceThumbs({ images, className }: { images?: string[]; className?: string }) {
  if (!images?.length) return null
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {images.map((src, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={i} src={src} alt={`רפרנס ${i + 1}`} className="size-12 rounded-md border border-border-neutral-default object-cover" />
      ))}
    </div>
  )
}

/** Shown over the panel while an image is dragged onto it. */
export function ReferenceDropHint({ show }: { show: boolean }) {
  if (!show) return null
  return (
    <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-[16px] border-2 border-dashed border-yellow-50 bg-white/85 dark:bg-gray-10/85">
      <span className="text-small-bold text-text-primary-default">שחררו כאן כדי לצרף רפרנס</span>
    </div>
  )
}
