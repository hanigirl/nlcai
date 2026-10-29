"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { MediaAiChat } from "@/components/media-ai-chat"
import {
  endLongWait,
  startLongWait,
  waitNoteReviewState,
  waitNoteVariant,
  type LongWaitJob,
} from "@/lib/long-wait"

// ── Review harness (only under ?waitnote=) ───────────────────────────────

const DEMO: Record<string, { job: LongWaitJob; title: string; done: string }> = {
  carousel: {
    job: { id: "waitnote-demo-carousel", verb: "מייצרים", what: "הקרוסלה" },
    title: "מציירים קרוסלת AI (מותג)... זה לוקח כמה דקות",
    done: "הקרוסלה (מותג) מוכנה",
  },
  b_roll: {
    job: { id: "waitnote-demo-broll", verb: "מייצרים", what: "הבי-רול" },
    title: "מייצרים בי-רול... זה יכול לקחת כשתי דקות",
    done: "הבי-רול נוצר",
  },
  story: {
    job: { id: "waitnote-demo-story", verb: "מייצרים", what: "הסטורי" },
    title: "מייצרים סטורי עם AI... זה יכול לקחת עד דקה",
    done: "הסטורי מוכן ונשמר",
  },
}

/** Demo jobs run on a timer — no fetch, no credits, no DB. */
function runDemo(key: keyof typeof DEMO, ms: number, outcome: "done" | "error" = "done") {
  const d = DEMO[key]
  startLongWait(d.job, d.title)
  return window.setTimeout(() => {
    endLongWait(d.job.id)
    if (outcome === "done") toast.success(d.done, { id: d.job.id, duration: 6000 })
    else
      toast.error("יצירת הקרוסלה נכשלה. נסו שוב בעוד רגע.", { id: d.job.id, duration: 12000 })
  }, ms)
}

const STATES = [
  { id: "running", label: "בזמן יצירה" },
  { id: "parallel", label: "כמה במקביל" },
  { id: "done", label: "הסתיים" },
  { id: "error", label: "שגיאה" },
  { id: "ai-edit", label: "עריכה עם AI" },
  { id: "ai-edit-away", label: "עריכה הסתיימה אחרי יציאה" },
] as const

/**
 * Mounted by /project under ?waitnote=a|b. Fires the chosen state with the
 * real helper (so the real toast / tray render), and a small review-only
 * state switcher. Demo jobs run ~40s: open another page from the sidebar
 * while one runs and the "ready" toast lands there.
 */
export function LongWaitReview() {
  // Read after mount — the server render has no URL to read.
  const [{ variant, state }, setReview] = useState<{ variant: ReturnType<typeof waitNoteVariant>; state: string }>({
    variant: null,
    state: "running",
  })
  useEffect(() => {
    setReview({ variant: waitNoteVariant(), state: waitNoteReviewState() ?? "running" })
  }, [])

  useEffect(() => {
    if (!variant) return
    const timers: number[] = []
    if (state === "running") timers.push(runDemo("carousel", 40000))
    if (state === "parallel") {
      timers.push(runDemo("carousel", 45000), runDemo("b_roll", 35000), runDemo("story", 25000))
    }
    if (state === "done") timers.push(runDemo("carousel", 2500))
    if (state === "error") timers.push(runDemo("carousel", 2500, "error"))
    if (state === "ai-edit-away") {
      timers.push(
        window.setTimeout(
          () =>
            toast.success("עריכת הקרוסלה הסתיימה. השקופיות החדשות מופיעות בפוסט.", {
              id: "waitnote-demo-edit",
              duration: 8000,
            }),
          1500,
        ),
      )
    }
    // Timers are NOT cleared on unmount on purpose: leaving /project is the
    // point of the demo. They only touch toasts and the in-memory tray.
    void timers
  }, [variant, state])

  if (!variant) return null

  const go = (s: string) => {
    const url = new URL(window.location.href)
    url.searchParams.set("state", s)
    window.location.href = url.toString()
  }

  return (
    <>
      <div
        dir="rtl"
        className="fixed top-3 left-1/2 z-50 flex -translate-x-1/2 flex-wrap items-center gap-1 rounded-full border border-border-neutral-default bg-white dark:bg-gray-10 px-2 py-1 shadow-md"
      >
        <span className="px-2 text-xs-body text-text-neutral-default">
          סקירה · אופציה {variant === "a" ? "A" : "B"}
        </span>
        {STATES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => go(s.id)}
            className={`rounded-full px-2.5 py-1 text-xs-body transition-colors hover:bg-gray-95 dark:hover:bg-gray-20 ${
              s.id === state ? "bg-bg-surface-primary-default text-text-primary-default" : "text-text-neutral-default"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      {state === "ai-edit" && (
        <MediaAiChat postId="waitnote-review" format="carousel" open onOpenChange={() => go("running")} />
      )}
    </>
  )
}
