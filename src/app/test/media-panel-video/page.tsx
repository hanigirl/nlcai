"use client"

/**
 * State preview — the media tab of a format that already has its video
 * (Hani, 2026-11-08: "המדיה צריך להיות הבירול עם נגן וזהו").
 *
 * Route: /test/media-panel-video
 *   ?format=b_roll        (default) the real MediaPanel on a b-roll with a clip
 *   ?format=talking_head  the same for a talking-head video
 *   ?src=<video URL>      the clip to show (a storage mp4 or a Drive link)
 *   ?empty=1              no media yet — the creation layout
 * Nothing is saved: the post id is a preview id the server doesn't know.
 */

import { Suspense, useState } from "react"
import { useSearchParams } from "next/navigation"
import { MediaPanel } from "@/components/media-panel"

function Preview() {
  const params = useSearchParams()
  const format = params.get("format") === "talking_head" ? "talking_head" : "b_roll"
  const src = params.get("empty") ? null : params.get("src")
  const [bRollUrl, setBRollUrl] = useState<string | null>(src)
  const noop = () => undefined
  return (
    <MediaPanel
      formatId={format}
      onClose={noop}
      postId="00000000-0000-4000-8000-00000000beef"
      postLoaded
      initialFormatMedia={format === "b_roll" && bRollUrl ? { b_roll: bRollUrl } : {}}
      thAvatar={null}
      thAudioBlob={null}
      thTranscript=""
      thVideoUrl={format === "talking_head" ? src : null}
      thSourceMode={format === "talking_head" && src ? "upload" : "choose"}
      onThAvatarChange={noop}
      onThAudioBlobChange={noop}
      onThTranscriptChange={noop}
      onThVideoUrlChange={noop}
      onThSourceModeChange={noop}
      thCoverImage={null}
      onThCoverImageChange={noop}
      carouselImages={null}
      carouselSlides={null}
      onCarouselImagesChange={noop}
      onCarouselSlidesChange={noop}
      carouselText=""
      carouselDriveLinks={null}
      onCarouselDriveLinksChange={noop}
      storyDriveLinks={null}
      onStoryDriveLinksChange={noop}
      onBRollUrlChange={setBRollUrl}
      bRollDriveLinks={null}
      onBRollDriveLinksChange={noop}
    />
  )
}

export default function MediaPanelVideoPreview() {
  return (
    <Suspense>
      <Preview />
    </Suspense>
  )
}
