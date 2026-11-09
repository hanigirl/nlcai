"use client"

/**
 * State preview for the talking head avatar picker (Nataliya, 2026-11-09:
 * after "טען אווטארים" she found no way back, and "עבור להגדרות" opened
 * settings on the wrong section).
 *
 * Drawn inside the real panel shell (MediaPanelFrame) with the real header
 * back arrow (PanelBackArrow) — the way back from the picker is that arrow,
 * one level up to the Drive / avatar choice, like every level of the panel.
 * "עברו להגדרות" lands on Settings → חיבורים → מדיה, on the HeyGen card.
 *
 *   ?state=
 *     not-connected — no HeyGen key (default)
 *     error         — the avatars could not be loaded
 *     empty         — no recorded avatars in the account
 *
 * Renders the real components. No fetches, no DB writes; the arrow and the
 * tabs here do nothing; the arrow really goes up one level.
 */

import { Suspense, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { MediaPanelFrame, PanelBackArrow } from "@/components/media-panel"
import { Button } from "@/components/ui/button"
import { FormatPanelTabs } from "@/components/format-cards/format-cards"
import {
  AvatarsEmpty,
  AvatarsLoadError,
  AvatarsNotConnected,
} from "@/components/avatar-picker"

const STATES = [
  { id: "not-connected", title: "HeyGen לא מחובר" },
  { id: "error", title: "האווטארים לא נטענו" },
  { id: "empty", title: "אין אווטארים מוקלטים" },
] as const

type StateId = (typeof STATES)[number]["id"]

function StateBody({ id }: { id: StateId }) {
  if (id === "error") return <AvatarsLoadError />
  if (id === "empty") return <AvatarsEmpty />
  return <AvatarsNotConnected />
}

function Preview() {
  const params = useSearchParams()
  const raw = params.get("state")
  const id: StateId = STATES.some((s) => s.id === raw) ? (raw as StateId) : "not-connected"
  // The real level change: arrow → the Drive / avatar choice, "טען אווטארים" → back here.
  const [level, setLevel] = useState<"choose" | "avatar">("avatar")

  return (
    <div dir="rtl" className="min-h-screen bg-bg-surface p-8">
      {/* State switcher, outside the panel. */}
      <div className="me-[440px] flex flex-col gap-3">
        <h1 className="text-p-bold text-text-primary-default">בחירת אווטאר: המצבים בלי אווטארים</h1>
        <div className="flex flex-wrap gap-4">
          {STATES.map((s) => (
            <Link
              key={s.id}
              href={`/test/avatar-picker-states?state=${s.id}`}
              className={`text-small hover:underline ${s.id === id ? "font-semibold text-text-primary-default" : "text-text-neutral-default"}`}
            >
              {s.title}
            </Link>
          ))}
        </div>
      </div>

      <MediaPanelFrame
        open
        title="דיבור למצלמה"
        onClose={() => {}}
        headerStart={level === "avatar" ? <PanelBackArrow onClick={() => setLevel("choose")} /> : undefined}
        tabs={<FormatPanelTabs value="media" onChange={() => {}} done={{ script: true }} />}
      >
        {level === "avatar" ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-neutral-default">בחרו אווטאר:</p>
            <StateBody id={id} />
          </div>
        ) : (
          // Stand-in for the level above (the real one lives inside the talking
          // head flow): the two ways, as the new panel shows them.
          <div className="flex flex-col gap-3">
            <Button variant="outline" className="w-full" disabled>
              סרטון מהדרייב
            </Button>
            <div className="flex items-center gap-3" role="separator">
              <div className="h-px flex-1 bg-border-neutral-default" />
              <span className="text-xs text-text-neutral-default">או</span>
              <div className="h-px flex-1 bg-border-neutral-default" />
            </div>
            <Button variant="outline" className="w-full gap-2" onClick={() => setLevel("avatar")}>
              טען אווטארים
            </Button>
          </div>
        )}
      </MediaPanelFrame>
    </div>
  )
}

export default function AvatarPickerStatesPage() {
  return (
    <Suspense fallback={null}>
      <Preview />
    </Suspense>
  )
}
