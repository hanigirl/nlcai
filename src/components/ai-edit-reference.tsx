"use client"

import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react"
import { ImagePlus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TooltipLabel } from "@/components/ui/tooltip"
import { MAX_REFERENCES } from "@/lib/ai-edit-references"
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

/** Any image file → a JPEG data URL small enough to send. */
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
      // Screenshots with transparency would turn black as JPEG.
      ctx.fillStyle = "#fff"
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
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
  const [dragging, setDragging] = useState(false)
  const refsRef = useRef(refs)
  useEffect(() => {
    refsRef.current = refs
  })

  const add = useCallback(async (files: File[]) => {
    const room = MAX_REFERENCES - refsRef.current.length
    if (room <= 0 || !files.length) return
    const shrunk = await Promise.all(files.slice(0, room).map((f) => shrink(f).catch(() => null)))
    setRefs((prev) => [...prev, ...shrunk.filter((s): s is string => !!s)].slice(0, MAX_REFERENCES))
  }, [])

  const remove = useCallback((i: number) => setRefs((prev) => prev.filter((_, j) => j !== i)), [])
  const clear = useCallback(() => setRefs([]), [])

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

  return { refs, add, remove, clear, onPaste, dropProps, dragging, full: refs.length >= MAX_REFERENCES }
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
          className="shrink-0 rounded-full text-text-neutral-default"
        >
          <ImagePlus className="size-4" />
        </Button>
      </TooltipLabel>
    </>
  )
}

/** Thumbnails waiting to be sent, above the composer. */
export function ReferenceTray({ r }: { r: ReferenceImages }) {
  if (!r.refs.length) return null
  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {r.refs.map((src, i) => (
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
