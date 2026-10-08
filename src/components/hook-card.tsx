"use client"

import { useState, useRef, useEffect } from "react"
import { ArrowLeft, Copy, Check, Trash2, Star, CheckCircle2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { toast } from "sonner"
import { copyToClipboard } from "@/lib/copy-to-clipboard"

interface HookCardProps {
  hookText: string
  onNavigate: () => void
  onCopy?: () => void
  onDelete?: () => void
  onEdit?: (newText: string) => void
  onToggleFavorite?: () => void
  isFavorite?: boolean
  used?: boolean
  /** Where the hook came from ("מתוך: מפגש סוכנים", "מוצר: ...") — a small tag. */
  sourceLabel?: string
  /** Just arrived (e.g. imported from a file). Fades back to normal when unset. */
  highlighted?: boolean
}

export function HookCard({ hookText, onNavigate, onCopy, onDelete, onEdit, onToggleFavorite, isFavorite, used, sourceLabel, highlighted }: HookCardProps) {
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(hookText)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.selectionStart = textareaRef.current.value.length
    }
  }, [editing])

  const handleCopy = async () => {
    // Was fire-and-forget: the rejection became an unhandled promise rejection
    // and "הועתק ללוח" showed even when nothing reached the clipboard.
    const ok = await copyToClipboard(hookText)
    if (!ok) {
      toast.error("ההעתקה נכשלה — נסו שוב")
      return
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    toast("הועתק ללוח")
    onCopy?.()
  }

  const handleSave = () => {
    const trimmed = editValue.trim()
    setEditing(false)
    if (trimmed && trimmed !== hookText) {
      onEdit?.(trimmed)
    } else {
      setEditValue(hookText)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSave()
    }
    if (e.key === "Escape") {
      setEditValue(hookText)
      setEditing(false)
    }
  }

  return (
    <Card
      dir="rtl"
      className={`group gap-4 rounded-[16px] p-4 py-4 shadow-none transition-all duration-700 ${
        highlighted
          ? "border-yellow-50 bg-bg-surface-primary-default dark:bg-gray-10 ring-2 ring-yellow-50/30"
          : "border-border-neutral-default bg-white dark:bg-gray-10"
      } ${
        used
          ? "opacity-60"
          : "hover:bg-bg-surface-primary-default hover:border-yellow-50 hover:ring-2 hover:ring-yellow-50/30"
      }`}
    >
      <CardContent className="flex flex-col gap-2 p-0">
        {/* Hook text */}
        {editing ? (
          <textarea
            ref={textareaRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            rows={2}
            className="text-sm text-text-primary-default bg-bg-surface-hover border-none rounded-lg px-2 py-1.5 resize-none outline-none"
          />
        ) : (
          <p
            onClick={() => { if (onEdit) { setEditing(true) } }}
            className={`text-sm text-text-primary-default line-clamp-2 ${onEdit ? "cursor-text" : ""}`}
          >
            {hookText}
          </p>
        )}

        {/* Actions row.
            All hover-revealed action buttons share the same sizing rhythm
            as /core_posts (size-7, size-3.5 icon, neutral default with a
            semantic hover tint) and every one is wrapped in a Tooltip so
            the user gets a "what does this do?" label on hover/focus —
            previously the row was a wall of unlabeled glyphs. The
            destructive button picks up `text-red-60` + `bg-red-95` on
            hover to match the danger-affordance pattern in /core_posts. */}
        <div className="flex items-center gap-2">
          {sourceLabel && (
            <span
              className="max-w-[55%] shrink truncate rounded-full bg-bg-surface px-2 py-0.5 text-[12px] text-text-neutral-default"
              title={sourceLabel}
            >
              {sourceLabel}
            </span>
          )}
          {/* Used indicator — always visible, with tooltip for full label. */}
          {used && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1 shrink-0">
                  <CheckCircle2 className="size-4 text-green-50" />
                  <span className="text-[12px] text-green-50">בשימוש</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>הוק שכבר השתמשתם בו</TooltipContent>
            </Tooltip>
          )}

          {/*
            Action buttons share the yellow-90/yellow-30 palette with the
            /core_posts cards (matching Hani's spec). Base color is
            yellow regardless of hover state so when the card is
            hovered (revealing them via opacity) they read as a single
            yellow surface. Inside HookCard a hover is never gray (Hani's
            exception to the app-wide gray hover): direct icon hover steps
            one shade darker, yellow-90 → yellow-80, and delete keeps only
            a red icon tint as its danger cue. The star keeps its own
            yellow-50 fill when favorited.
          */}

          {/* Favorite */}
          {onToggleFavorite && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onToggleFavorite}
                  aria-label={isFavorite ? "הסרה ממועדפים" : "הוספה למועדפים"}
                  className={`flex items-center justify-center size-7 shrink-0 rounded-md bg-yellow-90 text-yellow-30 hover:bg-yellow-80 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 ${
                    isFavorite ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  }`}
                >
                  <Star className={`size-3.5 ${isFavorite ? "fill-yellow-50 text-yellow-50" : ""}`} />
                </button>
              </TooltipTrigger>
              <TooltipContent>{isFavorite ? "הסרה ממועדפים" : "הוספה למועדפים"}</TooltipContent>
            </Tooltip>
          )}

          {/* Copy - visible on hover. Tooltip uses noun form ("העתקה",
              "הועתק") per project tone convention — no imperatives. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleCopy}
                aria-label={copied ? "הועתק" : "העתקה"}
                className="flex items-center justify-center size-7 shrink-0 rounded-md bg-yellow-90 text-yellow-30 hover:bg-yellow-80 hover:text-text-primary-default opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
              >
                {copied ? (
                  <Check className="size-3.5 text-green-600 dark:text-green-400" />
                ) : (
                  <Copy className="size-3.5" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent>{copied ? "הועתק" : "העתקה"}</TooltipContent>
          </Tooltip>

          {/* Delete - visible on hover. */}
          {onDelete && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onDelete}
                  aria-label="מחיקה"
                  className="flex items-center justify-center size-7 shrink-0 rounded-md bg-yellow-90 text-yellow-30 hover:bg-yellow-80 hover:text-red-60 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-button-destructive-default"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>מחיקה</TooltipContent>
            </Tooltip>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Navigate arrow - always visible */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onNavigate}
                aria-label="יצירת פוסט"
                className="flex items-center justify-center size-8 shrink-0 rounded-lg bg-bg-surface group-hover:bg-yellow-90 hover:bg-yellow-80 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
              >
                <ArrowLeft className="size-4 text-text-primary-default" />
              </button>
            </TooltipTrigger>
            <TooltipContent>יצירת פוסט</TooltipContent>
          </Tooltip>
        </div>
      </CardContent>
    </Card>
  )
}
