"use client"

/**
 * Variant A — approval as the last step ON each format's media card.
 *
 * The approve action sits at the bottom of the card, under the media, in ONE
 * row with the card's icon actions (download, delete — Hani, 2026-10-29): you
 * look at the slides, you press "אישור לתזמון", the card turns green. One
 * decision per format, made where the format is.
 */

import type { ReactNode } from "react"
import Link from "next/link"
import { CalendarPlus, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { ApprovalStatus } from "./use-format-approvals"

export function ApprovalCardFooter({
  status,
  formatNoun,
  onApprove,
  onRevoke,
  calendarHref,
  actions,
}: {
  status: ApprovalStatus
  /** Definite Hebrew noun for the format — "הקרוסלה", "הסטורי". */
  formatNoun: string
  onApprove: () => void
  onRevoke: () => void
  /** Where "ללוח התזמון" goes once approved. Omit to hide the link. */
  calendarHref?: string
  /** The card's icon actions (IconActionButton), placed in the same row. */
  actions?: ReactNode
}) {
  if (status === "no-media") {
    return actions ? <div className="flex w-full items-center gap-3">{actions}</div> : null
  }

  return (
    <div
      className="flex flex-col gap-3 w-full"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {status === "approved" || status === "scheduled" ? (
        // The way forward (calendar) in the action row; the way back
        // (revoke) under it.
        <>
          <div className="flex items-center gap-3">
            <span className="sr-only" role="status">מאושר לתזמון</span>
            {calendarHref && (
              <Button asChild variant="outline" className="flex-1 gap-2">
                <Link href={calendarHref}>
                  <CalendarPlus className="size-4" aria-hidden />
                  ללוח התזמון
                </Link>
              </Button>
            )}
            {actions}
          </div>
          <button
            type="button"
            onClick={onRevoke}
            className="self-center text-center text-small text-text-neutral-default underline underline-offset-2 hover:text-text-primary-default rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 cursor-pointer"
          >
            ביטול אישור
          </button>
        </>
      ) : (
        <>
          {status === "edited" && (
            <p className="rounded-lg bg-yellow-95 px-3 py-2 text-xs leading-relaxed text-yellow-20" role="status">
              ערכתם את {formatNoun} אחרי שאישרתם, אז האישור בוטל. אשרו שוב כשזה מוכן.
            </p>
          )}
          <div className="flex items-center gap-3">
            <Button onClick={onApprove} className="flex-1 gap-2">
              <Check className="size-4" strokeWidth={3} aria-hidden />
              {status === "edited" ? "אישור מחדש" : "אישור לתזמון"}
            </Button>
            {actions}
          </div>
          {status !== "edited" && (
            <p className="-mt-1 text-center text-xs leading-relaxed text-text-neutral-default">
              רק פורמטים מאושרים יופיעו ביומן לתזמון.
            </p>
          )}
        </>
      )}

    </div>
  )
}
