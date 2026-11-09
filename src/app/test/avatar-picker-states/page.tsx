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
 * tabs here only report that they were pressed.
 */

import { Suspense, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { MediaPanelFrame, PanelBackArrow } from "@/components/media-panel"
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
  const [backPressed, setBackPressed] = useState(false)

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
        {backPressed && (
          <p role="status" className="text-small text-text-neutral-default">
            בפאנל האמיתי החץ מחזיר רמה אחת למעלה: לבחירה בין סרטון מהדרייב לאווטאר.
          </p>
        )}
      </div>

      <MediaPanelFrame
        open
        title="דיבור למצלמה"
        onClose={() => {}}
        headerStart={<PanelBackArrow onClick={() => setBackPressed(true)} />}
        tabs={<FormatPanelTabs value="media" onChange={() => {}} done={{ script: true }} />}
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-neutral-default">בחרו אווטאר:</p>
          <StateBody id={id} />
        </div>
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
