"use client"

/**
 * State preview — clips on result cards and in the panel play (Hani,
 * 2026-11-06 / 2026-11-08).
 *
 * Route: /test/media-zone-video
 *   ?src=<storage mp4 URL>   — a stored clip in a card zone (as the b-roll card)
 *   ?drive=<Drive link>      — a Drive clip: a real player through
 *                              /api/media/drive-video (was a poster image)
 * A click on the picture opens the panel (the counter goes up); the bottom
 * control bar plays. No media files in the repo.
 */

import { Suspense, useState } from "react"
import { useSearchParams } from "next/navigation"
import { MediaPreviewZone } from "@/components/media-preview-zone"
import { DriveVideoPreview } from "@/components/drive-video-preview"
import { playableVideoSrc } from "@/lib/drive-media"

function Preview() {
  const params = useSearchParams()
  const src = params.get("src")
  const drive = params.get("drive")
  const [opens, setOpens] = useState(0)
  return (
    <main dir="rtl" className="min-h-screen bg-bg-surface p-6 flex flex-col items-center gap-4">
      <p className="text-p-bold text-text-primary-default">לחיצה על הקליפ פותחת את פאנל המדיה; פס הנגן מנגן</p>
      <p className="text-small text-text-neutral-default" data-testid="opens">
        הפאנל נפתח: {opens}
      </p>
      <div className="flex flex-wrap justify-center gap-6">
        <MediaPreviewZone onOpen={() => setOpens((n) => n + 1)} openLabel="החלפת הבי-רול" onAiEdit={() => undefined} aiClassName="bottom-12">
          <div className="w-[200px] aspect-[9/16] overflow-hidden rounded-xl border border-border-neutral-default bg-gray-20">
            <video
              src={src ? `${playableVideoSrc(src)}#t=0.001` : undefined}
              controls
              playsInline
              muted
              preload="metadata"
              className="w-full h-full object-cover bg-gray-20"
            />
          </div>
        </MediaPreviewZone>
        {drive && (
          <div className="flex flex-col items-center gap-2">
            <p className="text-small text-text-neutral-default">סרטון מגוגל דרייב (בכרטיס)</p>
            <div className="w-[200px] aspect-[9/16] overflow-hidden rounded-xl border border-border-neutral-default">
              <DriveVideoPreview url={drive} label="הבי-רול שלך" onOpen={() => setOpens((n) => n + 1)} />
            </div>
          </div>
        )}
      </div>
    </main>
  )
}

export default function MediaZoneVideoPreview() {
  return (
    <Suspense>
      <Preview />
    </Suspense>
  )
}
