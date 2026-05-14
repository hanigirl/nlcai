"use client"

/**
 * Floating action bar — appears once a core post is saved (the user has
 * "completed" creation and is ready for the next loop: scheduling).
 *
 * Why floating, not inline?
 *   The /project page is an InfiniteCanvas — the user pans freely. A CTA
 *   pinned to the end of the format chain would frequently scroll out of
 *   view at the moment the user is most likely to want it. Floating keeps
 *   the affordance reachable without taking up a "card slot" in the canvas.
 *
 * State machine — TWO states only after the queue removal (2026-05-05):
 *   1. Not scheduled → primary CTA "לכו ללוח שנה" (link to /calendar)
 *   2. Already scheduled → secondary "מתוזמן ל-…" + "ערכו בלוח" link
 *
 * What changed: the previous "in queue" intermediate state is gone. With
 * the queue panel now reading every post from the server, the moment a post
 * exists in the DB it's ALREADY in the panel — there's nothing to "add". So
 * this bar simply nudges the user to the calendar where they can drag the
 * post into a day/hour slot.
 */

import { useEffect, useState } from "react"
import { Calendar, CalendarCheck, CalendarPlus } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import {
  TIMING_KEYS,
  getScheduledByPostId,
} from "@/lib/timing-storage"

type Props = {
  /** Required — the bar is hidden until the post has an id. */
  corePostId: string | null
  /**
   * Optional cached hook text. Kept on the props for backward compat — no
   * longer written anywhere now that the queue is gone, but the calendar
   * may want to surface this label later.
   */
  hookText?: string | null
}

export function ScheduleInCalendarBar({ corePostId }: Props) {
  const [scheduledFor, setScheduledFor] = useState<string | null>(null)

  // Per-format era: a single core post can have multiple scheduled rows
  // (one per format). The bar's job is just to nudge "you have something
  // on the calendar" — so we pick the EARLIEST upcoming date across all
  // formats. That's the slot the user is most likely to be thinking about.
  const earliestScheduledDate = (rows: ReturnType<typeof getScheduledByPostId>) => {
    if (rows.length === 0) return null
    const sorted = [...rows].sort((a, b) =>
      a.scheduledDate.localeCompare(b.scheduledDate),
    )
    return sorted[0].scheduledDate
  }

  useEffect(() => {
    if (!corePostId) return
    setScheduledFor(earliestScheduledDate(getScheduledByPostId(corePostId)))
  }, [corePostId])

  useEffect(() => {
    if (!corePostId) return
    const onStorage = (e: StorageEvent) => {
      if (!e.key) return
      if (e.key === TIMING_KEYS.scheduled) {
        setScheduledFor(earliestScheduledDate(getScheduledByPostId(corePostId)))
      }
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [corePostId])

  if (!corePostId) return null

  // Common shell — placed bottom-end so it never crosses the sidebar (which
  // is at the start in RTL). 32px from each edge keeps it readable on
  // narrow viewports while not encroaching on the canvas content.
  return (
    <div
      dir="rtl"
      className="pointer-events-none fixed bottom-8 end-8 z-40 flex items-center gap-3"
    >
      {scheduledFor ? (
        <div className="pointer-events-auto inline-flex items-center gap-3 rounded-lg bg-bg-surface-primary-default border border-yellow-50 ps-4 pe-2 py-1.5 shadow-[0_8px_24px_rgb(0_0_0_/_0.08)]">
          <CalendarCheck className="size-4 text-text-primary-default" aria-hidden />
          <span className="text-small text-text-primary-default">
            מתוזמן ב-{formatShortDate(scheduledFor)}
          </span>
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <Link href="/calendar">
              ערכו בלוח
              <Calendar className="size-3.5" />
            </Link>
          </Button>
        </div>
      ) : (
        <div className="pointer-events-auto inline-flex items-center gap-3 rounded-lg bg-white dark:bg-gray-10 border border-border-neutral-default px-2 py-1.5 shadow-[0_8px_24px_rgb(0_0_0_/_0.08)]">
          <span className="text-small text-text-neutral-default ps-3">
            הפוסט נשמר — מתי לפרסם?
          </span>
          <Button asChild className="gap-1.5">
            <Link href="/calendar">
              <CalendarPlus className="size-4" />
              תיזמון פוסט
            </Link>
          </Button>
        </div>
      )}
    </div>
  )
}

function formatShortDate(dateKey: string): string {
  try {
    const [y, m, d] = dateKey.split("-").map((s) => parseInt(s, 10))
    const date = new Date(y, m - 1, d)
    return date.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" })
  } catch {
    return dateKey
  }
}
