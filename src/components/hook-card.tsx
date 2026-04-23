"use client"

import { useState, useRef, useEffect } from "react"
import { ArrowLeft, Copy, Check, Trash2, Star, CheckCircle2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
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

        {/* Actions row */}
        <div className="flex items-center gap-2">
          {/* Used indicator — always visible */}
          {used && (
            <div
              title="הוק שכבר השתמשתם בו"
              className="flex items-center gap-1 shrink-0"
            >
              <CheckCircle2 className="size-4 text-green-50" />
              <span className="text-[12px] text-green-50">בשימוש</span>
            </div>
          )}

          {/* Favorite */}
          {onToggleFavorite && (
            <button
              onClick={onToggleFavorite}
              className={`flex items-center justify-center size-8 shrink-0 rounded-lg transition-opacity cursor-pointer ${
                isFavorite ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              }`}
            >
              <Star className={`size-4 ${isFavorite ? "fill-yellow-50 text-yellow-50" : "text-text-primary-default"}`} />
            </button>
          )}

          {/* Copy - visible on hover */}
          <button
            onClick={handleCopy}
            className="flex items-center justify-center size-8 shrink-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
          >
            {copied ? (
              <Check className="size-4 text-green-600 dark:text-green-400" />
            ) : (
              <Copy className="size-4 text-text-primary-default" />
            )}
          </button>

          {/* Delete - visible on hover */}
          {onDelete && (
            <button
              onClick={onDelete}
              className="flex items-center justify-center size-8 shrink-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
            >
              <Trash2 className="size-4 text-text-primary-default" />
            </button>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Navigate arrow - always visible */}
          <button
            onClick={onNavigate}
            className="flex items-center justify-center size-8 shrink-0 rounded-lg bg-bg-surface group-hover:bg-bg-surface-primary-default-80 transition-colors cursor-pointer"
          >
            <ArrowLeft className="size-4 text-text-primary-default" />
          </button>
        </div>
      </CardContent>
    </Card>
  )
}
