"use client"

import { useCallback, useEffect, useState } from "react"
import { History } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { listArchived, onArchiveChanged, type ArchivedChat } from "@/lib/ai-chat-history"
import { restoreArchivedChat } from "@/lib/ai-chat-session-store"

const when = (iso: string) =>
  new Date(iso).toLocaleString("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })

/**
 * "שיחות קודמות" in an AI edit panel's header (Hani, 2026-11-09): the
 * conversations "שיחה חדשה" put aside for this post's panel. Picking one
 * brings it back as the current conversation; the one on screen goes to the
 * archive in its place. Same quiet icon as "שיחה חדשה"; only there once
 * something is archived.
 */
export function AiChatArchiveButton({ chatKey, disabled }: { chatKey: string; disabled?: boolean }) {
  const [items, setItems] = useState<ArchivedChat[]>([])
  const refresh = useCallback(() => {
    void listArchived(chatKey).then(setItems)
  }, [chatKey])
  useEffect(() => {
    refresh()
    return onArchiveChanged((k) => {
      if (k === chatKey) refresh()
    })
  }, [chatKey, refresh])

  if (!items.length) return null

  return (
    <DropdownMenu dir="rtl" onOpenChange={(open) => open && refresh()}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-label="שיחות קודמות"
              className="inline-flex size-7 items-center justify-center rounded-md text-text-neutral-default hover:bg-gray-95 dark:hover:bg-gray-20 hover:text-text-primary-default transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 disabled:pointer-events-none disabled:opacity-40"
            >
              <History className="size-4" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">שיחות קודמות</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="z-[60] w-72 max-h-80 overflow-y-auto">
        <DropdownMenuLabel className="text-xs-body text-text-neutral-default">שיחות קודמות</DropdownMenuLabel>
        {items.map((it) => (
          <DropdownMenuItem
            key={it.id}
            onSelect={() => void restoreArchivedChat(chatKey, it.id)}
            className="flex flex-col items-start gap-0.5 cursor-pointer"
          >
            <span className="line-clamp-1 w-full text-small text-text-primary-default">{it.title}</span>
            <span className="text-xs-body text-text-neutral-default">{when(it.updatedAt)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
