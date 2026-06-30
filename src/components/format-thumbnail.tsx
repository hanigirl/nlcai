"use client"

import { createElement, useState } from "react"
import { getFormatChipIcon } from "@/components/format-status-chip"
import type { FormatId } from "@/lib/timing-storage"

/**
 * Shared media thumbnail for a single (core post × format) card — used on
 * both the calendar grid (small) and the queue rail (larger). The per-format
 * asset can be a video (talking_head → heygen mp4) or an image (uploaded
 * story / carousel / image_post). We render a <video> for video URLs so the
 * browser paints the first frame as a still poster, and an <img> otherwise.
 * An asset that fails to load (or a format that's "ready" only via a Drive
 * link with no uploaded asset) falls back to the format's own icon on a
 * tinted disc, so a card never shows a broken image.
 */
export function FormatThumbnail({
  url,
  format,
  className = "size-6 rounded-md",
  iconClassName = "size-3.5",
  fallbackClassName = "bg-bg-surface-primary-default",
  fit = "cover",
}: {
  url?: string
  format: FormatId
  /**
   * Tailwind size/shape classes for the thumbnail box. Rounding lives here
   * (not hardcoded) so callers can render anything from a small `rounded-md`
   * chip thumbnail to a full-width `rounded-lg` banner on the queue rail
   * without a `rounded-*` collision.
   */
  className?: string
  /** Size classes for the fallback icon. */
  iconClassName?: string
  /**
   * Background of the no-media fallback box. Defaults to the soft brand
   * yellow used by the small calendar thumbnails. The queue-rail banner
   * passes `bg-gray-95` so its empty state matches the /core_posts card's
   * neutral "no media yet" placeholder instead of reading as a yellow block.
   */
  fallbackClassName?: string
  /**
   * object-fit for the media. `cover` (default) fills + crops the box while
   * keeping aspect ratio — right for portrait reels / stories / images.
   * `contain` fits the whole frame with padding — used for the square
   * carousel asset so the 1:1 frame isn't cropped inside a portrait slot.
   */
  fit?: "cover" | "contain"
}) {
  const [errored, setErrored] = useState(false)
  const isVideo =
    !!url && (/\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(url) || /\/video\//i.test(url))
  const fitClass = fit === "contain" ? "object-contain" : "object-cover"

  if (!url || errored) {
    return (
      <span
        className={`shrink-0 ${fallbackClassName} flex items-center justify-center text-text-neutral-default ${className}`}
      >
        {createElement(getFormatChipIcon(format), { className: iconClassName })}
      </span>
    )
  }
  return isVideo ? (
    <video
      // `#t=0.1` nudges the browser to seek to the first frame so the
      // thumbnail shows a real still instead of a black rectangle. The
      // fragment is client-only — it isn't sent to the server, so it's
      // safe even on signed URLs.
      src={`${url}#t=0.1`}
      muted
      playsInline
      preload="metadata"
      onError={() => setErrored(true)}
      className={`shrink-0 ${fitClass} bg-gray-95 pointer-events-none ${className}`}
    />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      loading="lazy"
      onError={() => setErrored(true)}
      className={`shrink-0 ${fitClass} bg-gray-95 ${className}`}
    />
  )
}
