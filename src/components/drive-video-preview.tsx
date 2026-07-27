"use client"

import { useState } from "react"
import { Play } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  extractDriveFileId,
  driveEmbedUrl,
  driveThumbnailUrl,
} from "@/lib/drive-media"

/**
 * Preview for a link-mode Google Drive video.
 *
 * Design note (2026-07-27, after Hani's feedback on the workflow card):
 * the obvious implementation — drop Drive's <iframe> player straight into
 * the card — looks broken at card size. Drive's player has a minimum
 * width of its own; squeezed into a ~200px column it overflows, gets
 * clipped by the container, and its play button lands off-centre. Worse,
 * inside the InfiniteCanvas the pointer events never reach the iframe, so
 * that off-centre button doesn't even respond. The result reads as "a
 * broken play button" — which is exactly what it is.
 *
 * So the card shows a FACADE we fully control: Drive's server-rendered
 * poster, cover-cropped and properly centred, under our own play affordance
 * (the same one the app already uses for video thumbnails). Clicking opens
 * a dialog where the real player gets room to render at its natural size —
 * so one click on Drive's control actually plays.
 *
 * We can't use a <video> at either size: Drive serves no CORS headers.
 */
export function DriveVideoPreview({
  url,
  label,
  className = "",
}: {
  url: string
  label?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [posterFailed, setPosterFailed] = useState(false)
  const fileId = extractDriveFileId(url)
  if (!fileId) return null

  const title = label ? `${label} — סרטון מגוגל דרייב` : "סרטון מגוגל דרייב"

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        // The canvas behind these cards drags on pointer-down. Without this
        // the press is swallowed before it ever reaches the button.
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        aria-label={`הפעלת ${title}`}
        className={`group relative block size-full overflow-hidden bg-gray-95 cursor-pointer ${className}`}
      >
        {!posterFailed && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={driveThumbnailUrl(fileId, 800)}
            alt=""
            onError={() => setPosterFailed(true)}
            className="size-full object-cover"
          />
        )}

        {/* Slight scrim so the control stays legible over a bright frame. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-black/10 transition-opacity duration-200 group-hover:opacity-80"
        />

        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <span className="flex size-12 items-center justify-center rounded-full bg-black/45 shadow-lg backdrop-blur-sm transition-transform duration-200 group-hover:scale-110 group-focus-visible:scale-110">
            <Play className="size-5 fill-white text-white ms-0.5" />
          </span>
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>{label ?? "הסרטון שלכם"}</DialogTitle>
          </DialogHeader>
          {/* 9:16 and tall enough that Drive's player renders at its natural
              size — the whole reason the card can't host it directly. */}
          <div className="relative mx-auto aspect-[9/16] w-full max-h-[70vh] overflow-hidden rounded-xl bg-black">
            <iframe
              src={driveEmbedUrl(fileId)}
              title={title}
              className="absolute inset-0 size-full border-0"
              allow="autoplay; fullscreen"
              allowFullScreen
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
