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
 *   ?cover=1              talking head with a cover (else the cover column's
 *                         empty state; "יצירת קאבר" fills it with a sample here)
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
  // A sample picture stands in for a cover — nothing is generated here.
  const [cover, setCover] = useState<string | null>(params.get("cover") ? "/images/onboarding-hero.png" : null)
  const [coverLoading, setCoverLoading] = useState(false)
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
      thCoverImage={cover}
      onThCoverImageChange={setCover}
      thAutoCover={false}
      thCoverLoading={coverLoading}
      // "מחיקת הקאבר": the column goes back to its empty state (nothing saved here).
      onThDeleteCover={() => setCover(null)}
      onThCreateCover={() => {
        setCoverLoading(true)
        setTimeout(() => {
          setCover("/images/onboarding-hero.png")
          setCoverLoading(false)
        }, 1200)
      }}
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
