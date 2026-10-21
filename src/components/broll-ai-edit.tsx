"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { startBRollEdit } from "@/lib/broll-generation-store"

/** A clip the Opus engine made — only those have a composition to edit. */
export function isEditableBRollUrl(url: string | null | undefined): boolean {
  return !!url && /\/b_roll\/[0-9a-f-]{36}\.mp4(?:[?#].*)?$/i.test(url)
}

/**
 * "עריכה עם AI" on the b-roll result card (Hani, 2026-10-22): she writes what
 * to change in this specific clip — size, colour, how the words come in,
 * timing — and Opus revises the animation. Opened from the card, not the media
 * panel: the edit acts on the clip, so it lives with the clip.
 *
 * Sending closes the dialog right away. The revision takes about a minute;
 * the card shows its skeleton meanwhile and a toast reports the result.
 */
export function BRollAiEditDialog({
  postId,
  open,
  onOpenChange,
}: {
  postId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [instruction, setInstruction] = useState("")

  const submit = () => {
    const text = instruction.trim()
    if (!text) return
    onOpenChange(false)
    void startBRollEdit(postId, text).then((ok) => {
      if (ok) setInstruction("")
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>עריכה עם AI</DialogTitle>
          <DialogDescription>כתבו מה לשנות בבי-רול, ו-AI יעדכן את האנימציה.</DialogDescription>
        </DialogHeader>
        <Textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          rows={4}
          dir="rtl"
          autoFocus
          aria-label="מה לשנות בבי-רול"
          placeholder="למשל: הכותרת גדולה יותר, בצבע הכתום של המותג, ושהמילים ייכנסו אחת אחרי השנייה"
          className="text-small"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <DialogFooter className="gap-2 sm:justify-start">
          <Button disabled={!instruction.trim()} onClick={submit}>
            עדכון הבי-רול
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            ביטול
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
