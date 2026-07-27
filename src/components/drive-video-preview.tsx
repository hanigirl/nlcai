"use client"

import { ExternalLink } from "lucide-react"
import { extractDriveFileId, driveEmbedUrl } from "@/lib/drive-media"

/**
 * Plays a Google Drive video through Drive's OWN embedded player.
 *
 * Why an <iframe> and not a <video>: Drive's direct-download endpoint sends
 * no CORS headers and hides large files behind a virus-scan interstitial,
 * so it can't back a <video src>. The embed player has neither problem and
 * works at any file size — which is the whole reason we stopped copying
 * multi-hundred-MB reels into our bucket just to show a preview.
 *
 * Requires the file to be shared as "anyone with the link". When it isn't,
 * Drive renders its own "request access" page inside the frame; the escape
 * hatch below gives the user a way out to fix sharing.
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
  const fileId = extractDriveFileId(url)
  if (!fileId) return null

  return (
    <div className={`relative size-full ${className}`}>
      <iframe
        src={driveEmbedUrl(fileId)}
        title={label ? `סרטון מגוגל דרייב — ${label}` : "סרטון מגוגל דרייב"}
        className="size-full border-0"
        allow="autoplay; fullscreen"
        allowFullScreen
      />
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="פתחו את הסרטון בגוגל דרייב"
        className="absolute end-2 top-2 inline-flex items-center gap-1 rounded-md bg-white/90 px-2 py-1 text-xs text-text-primary-default shadow-sm transition-colors hover:bg-white"
      >
        <ExternalLink className="size-3" aria-hidden />
        דרייב
      </a>
    </div>
  )
}
