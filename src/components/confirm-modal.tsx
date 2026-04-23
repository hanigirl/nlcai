"use client"

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

interface ConfirmModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
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
  const handleConfirm = () => {
    onConfirm()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
          <Button variant={confirmVariant} className="flex-1" onClick={handleConfirm}>
            {confirmLabel}
          </Button>
          <Button variant="secondary" className="flex-1" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
