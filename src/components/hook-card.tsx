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

interface HookCardProps {
  hookText: string
  onNavigate: () => void
  onCopy?: () => void
  onDelete?: () => void
  onEdit?: (newText: string) => void
  onToggleFavorite?: () => void
  isFavorite?: boolean
  used?: boolean
}

export function HookCard({ hookText, onNavigate, onCopy, onDelete, onEdit, onToggleFavorite, isFavorite, used }: HookCardProps) {
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

  const handleCopy = () => {
    navigator.clipboard.writeText(hookText)
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
      className={`group gap-4 rounded-[16px] border-border-neutral-default bg-white dark:bg-gray-10 p-4 py-4 shadow-none transition-all ${
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
            yellow surface; direct icon hover still flips to the
            semantic affordance — red for destructive, surface-hover
            for copy, and the star's own yellow-50 fill when favorited.
          */}

          {/* Favorite — bare star, one-to-one with the /ideas card favorite
              (no yellow-90 pill): outline yellow-30 (→ yellow-10 on hover)
              when off, solid yellow-50 fill when on. Kept identical to ideas
              so the "save" star reads the same across surfaces. */}
          {onToggleFavorite && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onToggleFavorite}
                  aria-label={isFavorite ? "הסרה ממועדפים" : "הוספה למועדפים"}
                  className={`flex items-center justify-center p-1 shrink-0 rounded-full transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 ${
                    isFavorite ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  }`}
                >
                  <Star className={`size-3.5 ${isFavorite ? "fill-yellow-50 text-yellow-50" : "text-yellow-30 hover:text-yellow-10"}`} />
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
                className="flex items-center justify-center size-7 shrink-0 rounded-md bg-yellow-90 text-yellow-30 hover:bg-bg-surface-hover hover:text-text-primary-default opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
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
                  className="flex items-center justify-center size-7 shrink-0 rounded-md bg-yellow-90 text-yellow-30 hover:bg-red-95 hover:text-red-60 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-button-destructive-default"
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
                className="flex items-center justify-center size-8 shrink-0 rounded-lg bg-bg-surface group-hover:bg-bg-surface-primary-default-80 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
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
