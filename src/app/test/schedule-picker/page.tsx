"use client"

/**
 * Visual playground for ScheduleFormatPicker.
 *
 * Route: /test/schedule-picker — DEV-ONLY surface for iterating on the
 * picker's design without having to drag a post on the calendar. No I/O,
 * no persistence: confirming just logs to the console.
 *
 * Three scenario buttons cover the readiness shapes the picker has to
 * handle:
 *   1. כל הפורמטים מוכנים        → 4 selectable rows
 *   2. שני פורמטים מוכנים        → 2 selectable + 2 disabled (mixed states)
 *   3. רק פורמט אחד מוכן         → 1 selectable + 3 disabled. The caller
 *                                  normally bypasses the picker in this
 *                                  case, but we still surface it so the
 *                                  disabled-row treatment is testable
 *                                  in isolation.
 */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ScheduleFormatPicker } from "@/components/schedule-format-picker"
import { createClient } from "@/lib/supabase/client"
import { isOwner } from "@/lib/owner"
import type { FormatId, FormatReadiness } from "@/lib/timing-storage"

type Scenario = {
  id: string
  label: string
  description: string
  formatStates: Record<FormatId, FormatReadiness>
}

const SCENARIOS: Scenario[] = [
  {
    id: "all-ready",
    label: "כל הפורמטים מוכנים",
    description: "4 שורות פעילות, כולן ניתנות לסימון.",
    formatStates: {
      story: "ready",
      talking_head: "ready",
      carousel: "ready",
      image_post: "ready",
    },
  },
  {
    id: "two-ready-two-scheduled",
    label: "שניים מוכנים, שניים מתוזמנים",
    description:
      "talking_head + image_post פעילים; story + carousel כבר על הלוח.",
    formatStates: {
      story: "scheduled",
      talking_head: "ready",
      carousel: "scheduled",
      image_post: "ready",
    },
  },
  {
    id: "mixed",
    label: "תערובת מצבים",
    description:
      "ready / scheduled / published / empty — לבדיקת כל הסגנונות בשורה אחת.",
    formatStates: {
      story: "ready",
      talking_head: "published",
      carousel: "empty",
      image_post: "scheduled",
    },
  },
  {
    id: "one-ready",
    label: "רק פורמט אחד מוכן",
    description: "1 פעיל, 3 חסומים — באמת הזרימה עוקפת זאת, מוצג להשוואה.",
    formatStates: {
      story: "empty",
      talking_head: "ready",
      carousel: "scheduled",
      image_post: "published",
    },
  },
]

export default function ScheduleFormatPickerTestPage() {
  const [activeScenario, setActiveScenario] = useState<Scenario | null>(null)

  // Owner gate — keeps the visual playground out of public view in
  // production. Non-owners are bounced home; owners see the playground
  // after the auth check resolves.
  const router = useRouter()
  const [granted, setGranted] = useState<boolean | null>(null)
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (isOwner(user?.email)) {
        setGranted(true)
      } else {
        setGranted(false)
        router.replace("/")
      }
    })
  }, [router])

  if (granted !== true) {
    return <div className="min-h-screen bg-bg-surface" />
  }

  return (
    <main
      dir="rtl"
      className="min-h-screen bg-bg-surface px-6 py-10"
    >
      <div className="mx-auto max-w-2xl">
        <header className="mb-8">
          <p className="text-xs-body text-text-neutral-default mb-1">
            סביבת בדיקה · /test/schedule-picker
          </p>
          <h1 className="text-text-primary-default text-2xl font-bold mb-2">
            תצוגה מקדימה — בחירת פורמטים לתזמון
          </h1>
          <p className="text-small text-text-neutral-default">
            לחצו על תרחיש כדי לפתוח את הדיאלוג עם נתוני דמה. אישור רושם
            ל-console ולא שומר כלום.
          </p>
        </header>

        <div className="flex flex-col gap-3">
          {SCENARIOS.map((scenario) => (
            <button
              key={scenario.id}
              type="button"
              onClick={() => setActiveScenario(scenario)}
              className="flex flex-col items-start gap-1 rounded-xl border border-border-neutral-default bg-white dark:bg-gray-10 px-4 py-3 text-right transition-all hover:border-gray-80 hover:bg-bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
            >
              <span className="text-p-bold text-text-primary-default">
                {scenario.label}
              </span>
              <span className="text-xs-body text-text-neutral-default">
                {scenario.description}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-8 flex justify-end">
          <Button
            variant="outline"
            onClick={() => setActiveScenario(null)}
            disabled={!activeScenario}
          >
            סגרו תצוגה
          </Button>
        </div>
      </div>

      {activeScenario && (
        <ScheduleFormatPicker
          open={!!activeScenario}
          onOpenChange={(open) => {
            if (!open) setActiveScenario(null)
          }}
          post={{
            corePostId: "test-core-post-id",
            displayText:
              "שלושת סוגי הפלט של AI שכל מעצב צריך להכיר — וכמעט אף אחד לא מבדיל ביניהם",
            formatStates: activeScenario.formatStates,
          }}
          targetLabel="15 במאי בשעה 11:00"
          onConfirm={(formats) => {
            console.log("[test/schedule-picker] confirmed", { formats })
            setActiveScenario(null)
          }}
        />
      )}
    </main>
  )
}
