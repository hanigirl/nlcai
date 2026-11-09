"use client"

/**
 * State preview for the talking head avatar picker (Nataliya, 2026-11-09:
 * after "טענו אווטארים" the message had no way back, and "עברו להגדרות"
 * opened settings on the wrong section).
 *
 * Every state where there is no avatar to pick now offers "חזרה" in place,
 * back to the two ways in (Drive / avatar). "עברו להגדרות" lands on
 * Settings → חיבורים → מדיה, scrolled to the HeyGen card.
 *
 *   ?state=
 *     not-connected — no HeyGen key: "עברו להגדרות" + "חזרה"
 *     error         — the avatars could not be loaded: "חזרה"
 *     empty         — no recorded avatars in the account: HeyGen link + "חזרה"
 *   no param = all three side by side.
 *
 * Renders the real components from the picker itself. No fetches, no DB
 * writes; "חזרה" here only reports that it was pressed.
 */

import { Suspense, useState } from "react"
import { useSearchParams } from "next/navigation"
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

function StateBody({ id, onBack }: { id: StateId; onBack: () => void }) {
  if (id === "not-connected") return <AvatarsNotConnected onBack={onBack} />
  if (id === "error") return <AvatarsLoadError onBack={onBack} />
  return <AvatarsEmpty onBack={onBack} />
}

function Preview() {
  const params = useSearchParams()
  const only = params.get("state")
  const shown = STATES.filter((s) => !only || s.id === only)
  const [pressed, setPressed] = useState<string | null>(null)

  return (
    <div dir="rtl" className="min-h-screen bg-bg-surface p-8">
      <div className="flex flex-wrap items-start gap-6">
        {shown.map((s) => (
          <section key={s.id} className="flex w-[400px] flex-col gap-3">
            <h2 className="text-small-bold text-text-primary-default">{s.title}</h2>
            {/* The panel's content column: same width and padding as the real one. */}
            <div className="rounded-xl border border-border-neutral-default bg-white px-6 py-6 dark:bg-gray-10">
              <div className="flex flex-col gap-3">
                <p className="text-sm text-text-neutral-default">בחרו אווטאר:</p>
                <StateBody id={s.id} onBack={() => setPressed(s.id)} />
              </div>
            </div>
            {pressed === s.id && (
              <p role="status" className="text-xs text-text-neutral-default">
                בפאנל האמיתי: חוזרים לבחירה בין סרטון מהדרייב לאווטאר.
              </p>
            )}
          </section>
        ))}
      </div>
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
