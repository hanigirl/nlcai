"use client"

/**
 * State preview — clicking a clip on a canvas result card (Hani, 2026-11-06).
 *
 * Route: /test/media-zone-video
 * The real MediaPreviewZone around a <video controls>, the way the b-roll and
 * story cards render their clip. A click on the picture opens the panel (the
 * counter goes up); a click on the bottom control bar is the player's own.
 * No fetches, no media files.
 */

import { useState } from "react"
import { MediaPreviewZone } from "@/components/media-preview-zone"

export default function MediaZoneVideoPreview() {
  const [opens, setOpens] = useState(0)
  return (
    <main dir="rtl" className="min-h-screen bg-bg-surface p-6 flex flex-col items-center gap-4">
      <p className="text-p-bold text-text-primary-default">לחיצה על הבי-רול פותחת את פאנל המדיה</p>
      <p className="text-small text-text-neutral-default" data-testid="opens">
        הפאנל נפתח: {opens}
      </p>
      <MediaPreviewZone onOpen={() => setOpens((n) => n + 1)} openLabel="החלפת הבי-רול" onAiEdit={() => undefined} aiClassName="bottom-12">
        <div className="w-[200px] aspect-[9/16] overflow-hidden rounded-xl border border-border-neutral-default bg-gray-20">
          <video controls playsInline muted preload="none" className="w-full h-full object-cover bg-gray-20" />
        </div>
      </MediaPreviewZone>
    </main>
  )
}
