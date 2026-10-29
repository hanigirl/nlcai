"use client"

import { SquarePen } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/**
 * "שיחה חדשה" in an AI edit panel's header — the only way a conversation
 * starts over (lib/ai-chat-session-store). Quiet: an icon beside the X, grey
 * hover, the label in a tooltip. Off while a request is still running.
 */
export function AiChatNewButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label="שיחה חדשה"
          className="inline-flex size-7 items-center justify-center rounded-md text-text-neutral-default hover:bg-gray-95 dark:hover:bg-gray-20 hover:text-text-primary-default transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 disabled:pointer-events-none disabled:opacity-40"
        >
          <SquarePen className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">שיחה חדשה</TooltipContent>
    </Tooltip>
  )
}
