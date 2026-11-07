"use client"

import { VideoWithPlay } from "@/components/video-with-play"
import { useState } from "react"
import { extractDriveFileId, driveEmbedUrl, driveThumbnailUrl, playableVideoSrc } from "@/lib/drive-media"

/**
 * A Google Drive video, as a REAL player (Hani, 2026-11-08: "אם זה סרטון אני
 * צריכה נגן שינגן לי את זה, יש שם תמונה").
 *
 * It used to be a facade: Drive's poster image with a play icon, and Drive's
 * own iframe player in a dialog on click — on a canvas card the click opened
 * the media panel instead, so a Drive clip read as a picture everywhere. Drive
 * sends no CORS headers, so a <video> can't point at Drive itself; it now
 * plays through our streaming proxy (/api/media/drive-video, with seeking),
 * Drive's poster as the first frame until it loads.
 *
 * `onOpen` (a canvas card): a click on the picture opens the media panel; the
 * player's own control bar (the bottom strip) plays — the rule every clip
 * card follows (components/media-preview-zone).
 */
const CONTROL_BAR_PX = 56

export function DriveVideoPreview({
  url,
  label,
  className = "",
  onOpen,
}: {
  url: string
  label?: string
  className?: string
  onOpen?: () => void
}) {
  const [failed, setFailed] = useState(false)
  const fileId = extractDriveFileId(url)
  if (!fileId) return null
  const title = label ? `${label} — סרטון מגוגל דרייב` : "סרטון מגוגל דרייב"

  // The browser can't play it (an iPhone HEVC clip on a browser without
  // HEVC, or the stream failed): Drive's own player, which transcodes.
  if (failed) {
    return (
      <div className={`relative size-full overflow-hidden bg-black ${className}`}>
        <iframe
          src={driveEmbedUrl(fileId)}
          title={title}
          className="absolute inset-0 size-full border-0"
          allow="autoplay; fullscreen"
          allowFullScreen
        />
      </div>
    )
  }

  return (
    <div
      className={`relative size-full overflow-hidden bg-black ${className}`}
      // The canvas behind these cards drags on pointer-down.
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        if (!onOpen) return
        const rect = e.currentTarget.getBoundingClientRect()
        if (e.clientY >= rect.bottom - CONTROL_BAR_PX) return
        e.preventDefault()
        e.stopPropagation()
        onOpen()
      }}
    >
      <VideoWithPlay
        src={playableVideoSrc(url)}
        poster={driveThumbnailUrl(fileId, 800)}
        controls
        playsInline
        preload="metadata"
        aria-label={title}
        onError={() => setFailed(true)}
        // A clip the browser can't decode (iPhone HEVC without HEVC support)
        // often loads WITHOUT an error and shows only the poster: no picture
        // track at all means Drive's own player instead.
        onLoadedMetadata={(e) => {
          if (e.currentTarget.videoWidth === 0) setFailed(true)
        }}
        className="size-full object-cover"
      />
    </div>
  )
}
