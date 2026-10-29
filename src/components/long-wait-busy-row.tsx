import { Loader2 } from "lucide-react"
import { LEAVE_SCREEN_NOTE } from "@/lib/long-wait"

/**
 * The busy line of a panel that reports its own progress (media-ai-chat),
 * with the leave-screen note under it — same promise as the long-wait toasts.
 */
export function LongWaitBusyRow({ text }: { text: string }) {
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
