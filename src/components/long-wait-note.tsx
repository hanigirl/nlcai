"use client"

import { useState } from "react"
import { ChevronDown, Loader2 } from "lucide-react"
import { LEAVE_SCREEN_NOTE, useLongWaitJobs, type LongWaitJob } from "@/lib/long-wait"

function jobLabel(j: LongWaitJob) {
  return `${j.verb} את ${j.what}`
}

/**
 * Variant b — one tray for everything running in the background. Mounted in
 * the root layout, so it stays on screen across every page; renders nothing
 * while no job is registered (i.e. always, without the review param).
 * Sits at the inline end of the bottom edge so it never covers the toast
 * stack (bottom-center) or the AI-edit panel (bottom-right).
 */
export function BackgroundJobsTray() {
  const list = useLongWaitJobs()
  const [open, setOpen] = useState(false)
  if (list.length === 0) return null
  const many = list.length > 1
  const title = many ? `${list.length} פעולות רצות ברקע` : jobLabel(list[0])

  return (
    <div
      dir="rtl"
      role="status"
      aria-live="polite"
      className="fixed bottom-6 left-6 z-50 w-[300px] max-w-[calc(100vw-2rem)] rounded-[12px] bg-gray-10 text-white shadow-xl"
    >
      <button
        type="button"
        onClick={() => many && setOpen((o) => !o)}
        aria-expanded={many ? open : undefined}
        aria-label={many ? (open ? "הסתרת הפעולות" : "הצגת הפעולות") : undefined}
        className={`flex w-full items-start gap-2.5 px-4 py-3 text-start ${many ? "cursor-pointer" : "cursor-default"} rounded-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50`}
      >
        <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-yellow-50" />
        <span className="flex flex-1 flex-col gap-0.5">
          <span className="text-small-bold">{title}</span>
          <span className="text-xs-body text-white/80 leading-relaxed">{LEAVE_SCREEN_NOTE}</span>
        </span>
        {many && (
          <ChevronDown
            className={`mt-0.5 size-4 shrink-0 text-white/80 transition-transform ${open ? "rotate-180" : ""}`}
          />
        )}
      </button>
      {many && open && (
        <ul className="flex flex-col gap-1.5 border-t border-white/10 px-4 py-3">
          {list.map((j) => (
            <li key={j.id} className="flex items-center gap-2 text-xs-body text-white/80">
              <span className="size-1.5 shrink-0 rounded-full bg-yellow-50" />
              {jobLabel(j)}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
