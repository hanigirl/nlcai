"use client"

/**
 * The visual language of "approved", shared by both design variants.
 *
 * Built on the existing green "מתוזמן" treatment — the green-success tokens
 * the chip's `set` palette and the Sheet's "מתוזמן ל-…" tag already use — so
 * approval reads as the first step of the same green family, not a new
 * language. Edited-after-approval borrows the chip's yellow "duplicated"
 * palette: it is work in progress again.
 */

import { Check, PencilLine } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ApprovalStatus } from "./use-format-approvals"

export function ApprovedTag({ className, label = "מאושר" }: { className?: string; label?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 h-6 px-2 rounded-full bg-green-success-97 text-green-success-50 border border-green-success-50 text-xs leading-none whitespace-nowrap",
        className,
      )}
    >
      <Check className="size-3 shrink-0" strokeWidth={3} aria-hidden />
      {label}
    </span>
  )
}

export function EditedTag({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 h-6 px-2 rounded-full bg-yellow-90 text-yellow-30 text-xs leading-none whitespace-nowrap",
        className,
      )}
    >
      <PencilLine className="size-3 shrink-0" aria-hidden />
      נערך אחרי האישור
    </span>
  )
}

export function PendingTag({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center h-6 px-2 rounded-full bg-gray-95 text-text-neutral-default text-xs leading-none whitespace-nowrap",
        className,
      )}
    >
      מחכה לאישור
    </span>
  )
}

/** Card border for a format's media card — green once approved. */
export function approvalCardBorder(status: ApprovalStatus | undefined): string {
  return status === "approved"
    ? "border-green-success-50 ring-1 ring-green-success-50"
    : "border-border-neutral-default"
}

/** Card header fill — green once approved, the usual yellow otherwise. */
export function approvalHeaderFill(status: ApprovalStatus | undefined): string {
  return status === "approved" ? "bg-green-success-97" : "bg-bg-surface-primary-default-80"
}

/** The tag that sits at the far end of a media card's header. */
export function ApprovalHeaderTag({ status }: { status: ApprovalStatus | undefined }) {
  if (status === "approved") return <ApprovedTag className="ms-auto" />
  if (status === "edited") return <EditedTag className="ms-auto" />
  return null
}

/** Definite Hebrew noun per format, for sentences ("ערכתם את הקרוסלה…"). */
export const FORMAT_NOUN: Record<string, string> = {
  carousel: "הקרוסלה",
  story: "הסטורי",
  image_post: "התמונה",
  talking_head: "הסרטון",
  b_roll: "הבי-רול",
}
