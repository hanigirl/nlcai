"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { LEAVE_SCREEN_NOTE, waitNoteVariant } from "@/lib/long-wait"

/**
 * The busy line of a panel that reports its own progress (media-ai-chat).
 * Under the review param the leave-screen note sits right under it; without
 * it, the line renders exactly as before.
 */
export function LongWaitBusyRow({ text }: { text: string }) {
  const [withNote] = useState(() => waitNoteVariant() !== null)
  if (!withNote) {
    return (
      <div className="flex items-center gap-2 text-small text-text-neutral-default">
        <Loader2 className="size-4 animate-spin text-yellow-50" />
        <span>{text}</span>
      </div>
    )
  }
  return (
    <div className="flex items-start gap-2 text-small text-text-neutral-default">
      <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-yellow-50" />
      <div className="flex flex-col gap-0.5">
        <span>{text}</span>
        <span className="text-xs-body">{LEAVE_SCREEN_NOTE}</span>
      </div>
    </div>
  )
}
