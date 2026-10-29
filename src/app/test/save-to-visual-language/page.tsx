"use client"

/**
 * State preview for the "לשמור לשפה הוויזואלית שלי" chip in the AI-edit panel.
 *
 * Route: /test/save-to-visual-language[?state=ready|saving|saved|auto|error]
 * No param = every state side by side. Each sits in a composer-shaped frame,
 * the width of the real panel. No fetches, no DB writes: the presentational
 * view only, with sample text.
 */

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { ArrowUp } from "lucide-react"
import { SaveToVisualLanguageChipView, type ChipState } from "@/components/save-to-visual-language-chip"

const SUMMARY = "כתוביות גדולות בצבע המותג, כל מילה נכנסת בקפיצה בנפרד"

const STATES: { id: ChipState; label: string }[] = [
  { id: "ready", label: "צ׳יפ מוכן (אחרי עריכה)" },
  { id: "saving", label: "בשמירה" },
  { id: "saved", label: "נשמר" },
  { id: "auto", label: "נשמר אוטומטית" },
  { id: "error", label: "שגיאה" },
]

function Frame({ state }: { state: ChipState }) {
  return (
    <div className="w-[380px] rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 shadow-xl">
      <div className="border-t-0 p-3">
        <SaveToVisualLanguageChipView
          state={state}
          summary={state === "saved" || state === "auto" ? SUMMARY : null}
          onSave={() => undefined}
          onUndo={() => undefined}
        />
        <div className="flex items-end gap-2 rounded-[12px] border border-border-neutral-default p-2">
          <span className="flex-1 p-1 text-small text-text-neutral-default">מה תרצו לשנות?</span>
          <span className="inline-flex size-8 items-center justify-center rounded-full bg-button-primary-disabled">
            <ArrowUp className="size-4 text-text-primary-disabled" />
          </span>
        </div>
      </div>
    </div>
  )
}

function Inner() {
  const only = useSearchParams().get("state")
  const shown = STATES.filter((s) => !only || s.id === only)
  return (
    <main dir="rtl" className="min-h-screen bg-bg-surface p-6">
      <h1 className="mb-6 text-small-bold text-text-primary-default">לשמור לשפה הוויזואלית שלי · מצבים</h1>
      <div className="flex flex-wrap gap-6">
        {shown.map((s) => (
          <section key={s.id} className="space-y-2">
            <p className="text-xs-body text-text-neutral-default">{s.label}</p>
            <Frame state={s.id} />
          </section>
        ))}
      </div>
    </main>
  )
}

export default function Page() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  )
}
