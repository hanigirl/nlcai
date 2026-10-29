"use client"

import { ArrowUp, Check, Loader2, RotateCw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { COPY_SUGGESTIONS, type CopyFormat } from "@/lib/format-copy-refine"

/**
 * Building blocks of the format-copy AI panel. All on existing components
 * (Button, Badge, Textarea) and the project's grey / green tokens — no new
 * visual treatment (Hani, 2026-10-29: "לעבוד לפי דיזיין סיסטם קיים").
 */

/** One-tap requests for this format. Sends straight away, like typing it. */
export function CopySuggestionChips({
  fid,
  disabled,
  onPick,
  className,
}: {
  fid: CopyFormat
  disabled?: boolean
  onPick: (text: string) => void
  className?: string
}) {
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {COPY_SUGGESTIONS[fid].map((s) => (
        <Button
          key={s}
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => onPick(s)}
          className="h-7 rounded-full px-3 text-xs-body font-normal"
        >
          {s}
        </Button>
      ))}
    </div>
  )
}

/** "6 שקופיות ← 4 שקופיות" — the measure this format is judged by. */
export function CopyChangeBadge({ change }: { change?: string | null }) {
  if (!change) return null
  return (
    // The neutral state of the project chip (format-status-chip "not-started").
    <Badge className="border-transparent bg-gray-98 text-gray-50 dark:bg-gray-20 dark:text-gray-80">{change}</Badge>
  )
}

/** Keep / undo for a proposal that is already showing in the card. */
export function CopyProposalActions({
  onKeep,
  onCancel,
}: {
  onKeep: () => void
  onCancel: () => void
}) {
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" onClick={onKeep} className="gap-1.5">
        <Check className="size-3.5" />
        שמירת השינוי
      </Button>
      <Button size="sm" variant="outline" onClick={onCancel}>
        ביטול
      </Button>
    </div>
  )
}

export function CopyAppliedNote({ canceled }: { canceled?: boolean }) {
  return canceled ? (
    <span className="text-xs-body text-text-neutral-default">השינוי בוטל, הטקסט חזר למה שהיה</span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs-body text-text-neutral-default">
      <Check className="size-3.5 text-green-success-50" />
      נשמר בטקסט
    </span>
  )
}

export function CopyLoadingLine() {
  return (
    <div role="status" className="flex items-center gap-2 text-small text-text-neutral-default">
      <Loader2 className="size-4 animate-spin text-yellow-50" />
      <span>משנה את הטקסט...</span>
    </div>
  )
}

export function CopyErrorLine({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2">
      <p className="text-small text-button-destructive-default">{message}</p>
      <Button size="sm" variant="outline" onClick={onRetry} className="gap-1.5">
        <RotateCw className="size-3.5" />
        ניסיון חוזר
      </Button>
    </div>
  )
}

/** The media already made won't follow the copy — say so before she edits. */
export function CopyMediaNote() {
  return (
    <p className="text-xs-body text-text-neutral-default">
      המדיה שכבר נוצרה לא תתעדכן לבד. אחרי השינוי אפשר ליצור אותה מחדש.
    </p>
  )
}

export function CopyComposer({
  value,
  onChange,
  onSend,
  busy,
  placeholder = "מה לשנות?",
  autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  busy: boolean
  placeholder?: string
  autoFocus?: boolean
}) {
  return (
    <div className="flex items-end gap-2 rounded-[12px] border border-border-neutral-default bg-white dark:bg-gray-10 p-2 focus-within:border-yellow-50 transition-colors">
      <Textarea
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            onSend()
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        rows={1}
        className="max-h-28 min-h-[36px] flex-1 resize-none border-none bg-transparent p-1 text-small shadow-none focus-visible:ring-0"
      />
      <Button
        size="icon-sm"
        onClick={onSend}
        disabled={!value.trim() || busy}
        aria-label="שליחה"
        className="shrink-0 rounded-full"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
      </Button>
    </div>
  )
}
