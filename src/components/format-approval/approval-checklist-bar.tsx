"use client"

/**
 * Variant B — one "finish the post" step for the whole post.
 *
 * A floating panel in the slot the schedule bar already owns (bottom-start =
 * the right edge in RTL, clear of the media side panel). It lists every
 * format the post was duplicated into, with a thumbnail and its state, and
 * asks one question: which of these are finished? Nothing is pre-checked —
 * the whole point is that a half-edited format never slips through on a
 * default. One confirm approves everything checked.
 *
 * The media cards on the canvas carry no buttons in this variant; they only
 * show the green "מאושר" tag, so the result still reads at a glance there.
 */

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { CalendarPlus, ChevronDown, ChevronUp, ListChecks, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import { ApprovedTag, EditedTag, PendingTag } from "./approval-visuals"
import type { FormatApprovals } from "./use-format-approvals"

export type ChecklistFormat = {
  id: string
  label: string
  icon: LucideIcon
  /** First image/frame of the format's media, for the row thumbnail. */
  thumb: string | null
}

export function ApprovalChecklistBar({
  formats,
  approvals,
  calendarHref,
  defaultOpen = true,
}: {
  formats: ChecklistFormat[]
  approvals: FormatApprovals
  calendarHref?: string
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [checked, setChecked] = useState<Record<string, boolean>>({})

  // A row that stops being approvable (or becomes approved) drops its tick.
  const statusKey = formats.map((f) => `${f.id}:${approvals.statusOf(f.id)}`).join(",")
  useEffect(() => {
    setChecked((prev) => {
      const next: Record<string, boolean> = {}
      for (const f of formats) {
        const s = approvals.statusOf(f.id)
        if ((s === "pending" || s === "edited") && prev[f.id]) next[f.id] = true
      }
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusKey])

  const toApprove = useMemo(
    () => formats.filter((f) => checked[f.id]).map((f) => f.id),
    [formats, checked],
  )

  const { approvedCount } = approvals
  const total = formats.length

  return (
    <div
      dir="rtl"
      className="pointer-events-none fixed bottom-8 start-8 z-40 flex flex-col items-start"
    >
      <div className="pointer-events-auto w-[380px] rounded-[16px] border border-border-neutral-default bg-white dark:bg-gray-10 shadow-[0_8px_24px_rgb(0_0_0_/_0.08)] overflow-hidden">
        {/* Header — doubles as the collapse toggle. */}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full items-center gap-2 px-4 py-3 text-start hover:bg-gray-95 dark:hover:bg-gray-20 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-yellow-50"
        >
          <ListChecks className="size-4 shrink-0 text-text-primary-default" aria-hidden />
          <span className="text-small-bold text-text-primary-default">מה מוכן לתזמון?</span>
          <span
            className={cn(
              "ms-auto text-xs tabular-nums",
              approvedCount > 0 ? "text-green-success-50" : "text-text-neutral-default",
            )}
          >
            {approvedCount} מתוך {total} מאושרים
          </span>
          {open ? (
            <ChevronDown className="size-4 shrink-0 text-text-neutral-default" aria-hidden />
          ) : (
            <ChevronUp className="size-4 shrink-0 text-text-neutral-default" aria-hidden />
          )}
        </button>

        {open && (
          <div className="flex flex-col gap-3 border-t border-border-neutral-default px-4 pt-3 pb-4">
            <p className="text-xs leading-relaxed text-text-neutral-default">
              סמנו את מה שסיימתם. רק פורמטים מאושרים יופיעו ביומן.
            </p>

            <ul className="flex flex-col gap-1" aria-label="פורמטים לאישור">
              {formats.map((f) => {
                const status = approvals.statusOf(f.id)
                const Icon = f.icon
                const selectable = status === "pending" || status === "edited"
                const isApproved = status === "approved"
                const inputId = `approve-${f.id}`
                return (
                  <li
                    key={f.id}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-2 py-2",
                      isApproved && "bg-green-success-97",
                      status === "no-media" && "opacity-60",
                    )}
                  >
                    <Checkbox
                      id={inputId}
                      checked={isApproved || !!checked[f.id]}
                      disabled={!selectable}
                      onCheckedChange={(v) =>
                        setChecked((prev) => ({ ...prev, [f.id]: v === true }))
                      }
                      className={cn(
                        isApproved &&
                          "data-[state=checked]:bg-green-success-50 disabled:opacity-100",
                      )}
                    />
                    <div className="size-9 shrink-0 overflow-hidden rounded-md border border-border-neutral-default bg-bg-surface flex items-center justify-center">
                      {f.thumb ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={f.thumb} alt="" className="size-full object-cover" />
                      ) : (
                        <Icon className="size-4 text-text-neutral-default" aria-hidden />
                      )}
                    </div>
                    <label
                      htmlFor={inputId}
                      className={cn(
                        "flex-1 text-small text-text-primary-default",
                        selectable && "cursor-pointer",
                      )}
                    >
                      {f.label}
                    </label>
                    {status === "approved" ? (
                      <span className="flex items-center gap-2">
                        <ApprovedTag />
                        <button
                          type="button"
                          onClick={() => approvals.revoke(f.id)}
                          aria-label={`ביטול אישור — ${f.label}`}
                          className="text-xs text-text-neutral-default underline underline-offset-2 hover:text-text-primary-default rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 cursor-pointer"
                        >
                          ביטול
                        </button>
                      </span>
                    ) : status === "edited" ? (
                      <EditedTag />
                    ) : status === "pending" ? (
                      <PendingTag />
                    ) : (
                      <span className="text-xs text-text-neutral-default">אין עדיין מדיה</span>
                    )}
                  </li>
                )
              })}
            </ul>

            <div className="flex items-center gap-2">
              <Button
                className="flex-1"
                disabled={toApprove.length === 0}
                onClick={() => {
                  for (const id of toApprove) approvals.approve(id)
                }}
              >
                {toApprove.length === 0
                  ? "סמנו פורמט לאישור"
                  : toApprove.length === 1
                    ? "אישור פורמט אחד"
                    : `אישור ${toApprove.length} פורמטים`}
              </Button>
              {approvedCount > 0 && calendarHref && (
                <Button asChild variant="outline" className="gap-1.5">
                  <Link href={calendarHref}>
                    <CalendarPlus className="size-4" aria-hidden />
                    ללוח
                  </Link>
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
