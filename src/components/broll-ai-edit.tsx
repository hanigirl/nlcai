"use client"

import { useState } from "react"
import { Loader2, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { startBRollEdit } from "@/lib/broll-generation-store"

/**
 * The canvas card's "עריכה עם AI" opens the media panel straight into the
 * edit box. The panel mounts on open, so a one-shot flag read on mount is
 * enough — no shared state to keep in sync.
 */
let openOnMount = false
export function requestBRollAiEditOpen(): void {
  openOnMount = true
}

/** A clip the Opus engine made — only those have a composition to edit. */
export function isEditableBRollUrl(url: string | null | undefined): boolean {
  return !!url && /\/b_roll\/[0-9a-f-]{36}\.mp4(?:[?#].*)?$/i.test(url)
}

/**
 * "עריכה עם AI" under the b-roll (Hani, 2026-10-22): she writes what to change
 * in this specific b-roll — size, colour, how the words come in, timing — and
 * Opus revises the animation. Collapsed to one button until she opens it.
 */
export function BRollAiEdit({ postId, busy }: { postId: string; busy: boolean }) {
  const [open, setOpen] = useState(() => {
    const requested = openOnMount
    openOnMount = false
    return requested
  })
  const [instruction, setInstruction] = useState("")

  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="w-[200px] gap-1.5 bg-white dark:bg-gray-10"
        disabled={busy}
        onClick={() => setOpen(true)}
      >
        <Sparkles className="size-3.5" aria-hidden />
        עריכה עם AI
      </Button>
    )
  }

  const submit = async () => {
    const ok = await startBRollEdit(postId, instruction)
    if (ok) {
      setInstruction("")
      setOpen(false)
    }
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <label htmlFor={`broll-edit-${postId}`} className="text-small-bold text-text-primary-default">
        מה לשנות בבי-רול?
      </label>
      <Textarea
        id={`broll-edit-${postId}`}
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        rows={3}
        dir="rtl"
        autoFocus
        disabled={busy}
        placeholder="למשל: הכותרת גדולה יותר, בצבע הכתום של המותג, ושהמילים ייכנסו אחת אחרי השנייה"
        className="bg-white text-small dark:bg-gray-10"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && instruction.trim() && !busy) {
            e.preventDefault()
            void submit()
          }
        }}
      />
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={!instruction.trim() || busy} onClick={() => void submit()} className="gap-1.5">
          {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          עדכון הבי-רול
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
          ביטול
        </Button>
      </div>
    </div>
  )
}
