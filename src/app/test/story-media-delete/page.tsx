"use client"

/**
 * State preview — the story's מדיה tab around a delete (Nataliya, 2026-11-09:
 * "המדיה בסטורי לא מופיע נעלם").
 *
 * The tab shows her story at the top; the story flow under it stays mounted,
 * only hidden. Deleting the story from that top media cleared the page's
 * frames but not the flow's own copy, and the flow hides its first step while
 * it holds a story — so the tab went blank. The flow now follows the page
 * (`useFollowPageStoryFrames`, the same hook the real flow uses).
 *
 * Real components: FormatPanelMedia (the top media + its trash) and
 * MediaSourceChooser (the first step). Sample frames, no fetches, no DB writes.
 *
 *   ?state=media    — the story in the tab
 *   ?state=deleted  — right after the trash: the first step is back
 *   (no param)      — both, plus a live one to delete yourself
 */

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { FormatPanelMedia } from "@/components/format-cards/format-cards"
import { MediaSourceChooser } from "@/components/media-source-chooser"
import { useFollowPageStoryFrames } from "@/components/media-panel"

// Full URLs, like her saved frames (a bare path reads as base64 to the player).
const framesAt = (origin: string) =>
  ["ai-light", "ai-dark", "ai-amber"].map((n) => `${origin}/images/carousel-templates/${n}.png`)
let FRAMES: string[] = []

/** The story's מדיה tab, wired the way the project page wires it. */
function StoryMediaTab({ startDeleted = false }: { startDeleted?: boolean }) {
  // The page's frames (what the card and the top of the tab read).
  const [pageFrames, setPageFrames] = useState<string[] | null>(FRAMES)
  // The flow's own copy — seeded at mount like the real flow.
  const [flowSet, setFlowSet] = useState<string[]>(FRAMES)
  useFollowPageStoryFrames(true, pageFrames, (now) => setFlowSet(now))
  // "deleted": the trash, pressed right after mount — the hook does the rest.
  useEffect(() => {
    if (startDeleted) setPageFrames(null)
  }, [startDeleted])

  const hasMedia = !!pageFrames?.length
  return (
    <div className="flex w-[340px] flex-col gap-4 rounded-xl border border-border-neutral-default bg-white p-6 dark:bg-gray-10">
      {hasMedia ? (
        <FormatPanelMedia
          fid="story"
          media={{ kind: "slides", items: pageFrames! }}
          storyPlayer
          onDeleteMedia={() => setPageFrames(null)}
        />
      ) : (
        <>
          {flowSet.length === 0 && (
            <MediaSourceChooser
              format="story"
              brandTemplate={null}
              onExisting={() => setPageFrames(FRAMES)}
              onAi={() => setPageFrames(FRAMES)}
            />
          )}
          {flowSet.length > 0 && (
            <p className="text-center text-xs text-text-neutral-default">
              (ריק — זה הבאג)
            </p>
          )}
        </>
      )}
    </div>
  )
}

const STATES = [
  { id: "media", title: "הסטורי בלשונית המדיה", node: <StoryMediaTab /> },
  { id: "deleted", title: "אחרי מחיקה: הצעד הראשון חוזר", node: <StoryMediaTab startDeleted /> },
] as const

function Preview() {
  const state = useSearchParams().get("state")
  // Client only: the frames need this page's origin.
  const [ready, setReady] = useState(false)
  useEffect(() => {
    FRAMES = framesAt(window.location.origin)
    setReady(true)
  }, [])
  if (!ready) return null
  const shown = STATES.filter((s) => !state || s.id === state)
  return (
    <div dir="rtl" className="min-h-screen bg-bg-surface p-8">
      <div className="flex flex-wrap items-start gap-8">
        {shown.map((s) => (
          <section key={s.id} className="flex flex-col gap-3">
            <h2 className="text-small-bold text-text-primary-default">{s.title}</h2>
            {s.node}
          </section>
        ))}
        {!state && (
          <section className="flex flex-col gap-3">
            <h2 className="text-small-bold text-text-primary-default">
              לנסות: מחיקה מהאייקון על המדיה
            </h2>
            <StoryMediaTab />
          </section>
        )}
      </div>
    </div>
  )
}

export default function StoryMediaDeletePreview() {
  return (
    <Suspense>
      <Preview />
    </Suspense>
  )
}
