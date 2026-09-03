"use client"

import { useEffect, useRef, useState } from "react"
import { Check, Loader2, Trash2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface NewHookCardProps {
  products: { id: string; name: string }[]
  /** Resolves true when the hook was persisted; the card is then unmounted by the parent. */
  onSave: (text: string, productId: string | null) => Promise<boolean>
  onDiscard: () => void
}

/**
 * A hook the user writes themselves, as a card in the warehouse grid.
 *
 * It's a draft until saved: nothing is written to the DB while typing, so
 * discarding it is free. Same footprint as HookCard so it slots into the
 * grid without the layout jumping; the yellow surface says "not saved yet".
 */
export function NewHookCard({ products, onSave, onDiscard }: NewHookCardProps) {
  const [text, setText] = useState("")
  const [productId, setProductId] = useState("")
  const [saving, setSaving] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const canSave = text.trim().length > 0 && !saving

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    const ok = await onSave(text.trim(), productId || null)
    // On success the parent removes this card; only reset when it stays.
    if (!ok) setSaving(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void handleSave()
    }
    if (e.key === "Escape") onDiscard()
  }

  return (
    <Card
      dir="rtl"
      className="gap-4 rounded-[16px] border-border-neutral-default bg-bg-surface-primary-default p-4 py-4 shadow-none ring-2 ring-yellow-90 dark:ring-yellow-30"
    >
      <CardContent className="flex flex-col gap-3 p-0">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          placeholder="כתוב פה את ההוק שלך"
          aria-label="הוק חדש"
          className="text-sm text-text-primary-default placeholder:text-text-neutral-default bg-transparent border-none rounded-lg px-2 py-1.5 resize-none outline-none"
        />

        {products.length > 0 && (
          <Select
            selectSize="small"
            variant="homepage"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            aria-label="שיוך למוצר"
          >
            <option value="">בלי מוצר (כללי)</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        )}

        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onDiscard}
                disabled={saving}
                aria-label="ביטול"
                className="flex items-center justify-center size-7 shrink-0 rounded-md bg-yellow-90 text-yellow-30 hover:bg-red-95 hover:text-red-60 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-button-destructive-default disabled:opacity-50"
              >
                <Trash2 className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>ביטול</TooltipContent>
          </Tooltip>

          <div className="flex-1" />

          <Button size="sm" onClick={handleSave} disabled={!canSave} className="gap-1.5">
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            {saving ? "שומר..." : "שמירה"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
