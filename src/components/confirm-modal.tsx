"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

interface ConfirmModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void | Promise<void>
  confirmVariant?: "destructive" | "default" | "danger"
  dir?: "rtl" | "ltr"
}

export function ConfirmModal({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  confirmVariant = "destructive",
  dir = "rtl",
}: ConfirmModalProps) {
  // While onConfirm is awaiting (e.g. an async DB delete), keep the modal
  // open and disable the buttons. Closing immediately while a fire-and-forget
  // fetch is still in flight lets the user refresh before the request lands —
  // which made deleted videos reappear after a refresh.
  const [isConfirming, setIsConfirming] = useState(false)

  const handleConfirm = async () => {
    setIsConfirming(true)
    try {
      await onConfirm()
    } finally {
      setIsConfirming(false)
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!isConfirming) onOpenChange(next) }}>
      <DialogContent dir={dir} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && (
            <DialogDescription className="text-[16px] text-text-neutral-default">
              {description}
            </DialogDescription>
          )}
        </DialogHeader>
        <DialogFooter className="flex flex-row-reverse gap-2 w-full sm:justify-start">
          <Button variant={confirmVariant} className="flex-1" onClick={handleConfirm} disabled={isConfirming}>
            {isConfirming ? <Loader2 className="size-4 animate-spin" /> : confirmLabel}
          </Button>
          <Button variant="secondary" className="flex-1" onClick={() => onOpenChange(false)} disabled={isConfirming}>
            {cancelLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
