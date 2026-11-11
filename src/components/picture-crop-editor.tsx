"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, ZoomIn, ZoomOut } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Slider } from "@/components/ui/slider"
import { CROP_ASPECT, MAX_ZOOM, cropRect, type PictureCrop } from "@/lib/picture-crop"

/**
 * "חיתוך" (Hani, 2026-11-11): her whole picture in the 4:5 frame — drag it to
 * choose the part that shows, the zoom slider to come closer. Save makes the
 * new picture (lib/picture-crop, /api/media/crop); the page saves the set.
 */
export function PictureCropEditor({
  url,
  onDone,
  onCancel,
}: {
  /** The picture as shown now (a captioned render, a cut, or her file). */
  url: string
  /** The new picture, made — the page puts it in place and saves. */
  onDone: (newUrl: string) => Promise<void> | void
  onCancel: () => void
}) {
  const [src, setSrc] = useState<{ original: string; width: number; height: number } | null>(null)
  const [crop, setCrop] = useState<PictureCrop>({ cx: 0.5, cy: 0.5, zoom: 1 })
  const [saving, setSaving] = useState(false)
  const frameRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; crop: PictureCrop } | null>(null)
  const [frameW, setFrameW] = useState(0)

  useEffect(() => {
    let live = true
    fetch(`/api/media/crop?url=${encodeURIComponent(url)}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(data.message || "load_failed")
        return data as { original: string; width: number; height: number; crop: PictureCrop }
      })
      .then((d) => {
        if (!live) return
        setSrc({ original: d.original, width: d.width, height: d.height })
        setCrop(d.crop)
      })
      .catch((e) => {
        if (!live) return
        toast.error(e instanceof Error && e.message !== "load_failed" ? e.message : "לא הצלחנו לטעון את התמונה המקורית. נסו שוב.")
        onCancel()
      })
    return () => {
      live = false
    }
  }, [url, onCancel])

  useEffect(() => {
    const el = frameRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setFrameW(el.clientWidth))
    ro.observe(el)
    setFrameW(el.clientWidth)
    return () => ro.disconnect()
  }, [src])

  // The frame shows `rect` of the original; the picture is laid out so.
  const rect = src ? cropRect(src.width, src.height, crop) : null
  const scale = rect && frameW ? frameW / rect.width : 0

  const clampCentre = (c: PictureCrop): PictureCrop => {
    if (!src) return c
    const r = cropRect(src.width, src.height, c)
    return { ...c, cx: (r.left + r.width / 2) / src.width, cy: (r.top + r.height / 2) / src.height }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (!src || saving) return
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, crop }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || !src || !scale) return
    // Moving the picture right shows more of its left side: the frame's centre moves the other way.
    const dx = (e.clientX - d.x) / scale / src.width
    const dy = (e.clientY - d.y) / scale / src.height
    setCrop(clampCentre({ ...d.crop, cx: d.crop.cx - dx, cy: d.crop.cy - dy }))
  }
  const onPointerUp = () => {
    drag.current = null
  }

  const save = async () => {
    if (!src || saving) return
    setSaving(true)
    try {
      const r = await fetch("/api/media/crop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, crop }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok || !data.url) throw new Error(data.message || "החיתוך לא נשמר. נסו שוב.")
      await onDone(data.url as string)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "החיתוך לא נשמר. נסו שוב.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-3" onMouseDown={(e) => e.stopPropagation()} data-media-control="">
      <div
        ref={frameRef}
        className="relative w-full touch-none select-none overflow-hidden rounded-xl bg-gray-95 dark:bg-gray-20"
        style={{ aspectRatio: `${CROP_ASPECT}` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-label="גררו את התמונה כדי לבחור את החלק שיופיע"
        role="application"
      >
        {!src || !rect || !scale ? (
          <Skeleton className="absolute inset-0 rounded-none" />
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src.original}
              alt=""
              draggable={false}
              className="pointer-events-none absolute max-w-none cursor-grab"
              style={{
                width: src.width * scale,
                height: src.height * scale,
                left: -rect.left * scale,
                top: -rect.top * scale,
              }}
            />
            {/* Thirds, so she can place the subject (shown while cropping). */}
            <div aria-hidden className="pointer-events-none absolute inset-0 cursor-grab border-2 border-white/80 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.15)]">
              <div className="absolute inset-y-0 left-1/3 w-px bg-white/50" />
              <div className="absolute inset-y-0 left-2/3 w-px bg-white/50" />
              <div className="absolute inset-x-0 top-1/3 h-px bg-white/50" />
              <div className="absolute inset-x-0 top-2/3 h-px bg-white/50" />
            </div>
          </>
        )}
        {saving && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/50 dark:bg-gray-10/50">
            <Loader2 className="size-6 animate-spin text-text-primary-default" aria-hidden />
          </div>
        )}
      </div>

      <div className="flex items-center gap-3" dir="ltr">
        <ZoomOut className="size-4 shrink-0 text-text-neutral-default" aria-hidden />
        <Slider
          aria-label="זום"
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={[crop.zoom]}
          disabled={!src || saving}
          onValueChange={([z]) => setCrop((c) => clampCentre({ ...c, zoom: z }))}
        />
        <ZoomIn className="size-4 shrink-0 text-text-neutral-default" aria-hidden />
      </div>
      <p className="text-xs text-text-neutral-default">גררו את התמונה כדי לבחור את החלק שיופיע, ובסליידר מתקרבים.</p>

      <div className="flex items-center gap-3">
        <Button className="flex-1" onClick={save} disabled={!src || saving}>
          {saving ? "שומר…" : "שמירת החיתוך"}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          ביטול
        </Button>
      </div>
    </div>
  )
}
