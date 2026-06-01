"use client"

import { Plus, Trash2, Loader2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { validateCreatorInput } from "@/lib/creator-url"

export interface CreatorEntry {
  id?: string
  url: string
}

interface CreatorsListProps {
  creators: CreatorEntry[]
  onChange: (creators: CreatorEntry[]) => void
  showRequiredAsterisk?: boolean
  addButtonLabel?: string
  addButtonFullWidth?: boolean
  onSaveCreator?: (index: number) => Promise<void> | void
  onRemoveCreator?: (index: number) => Promise<void> | void
  savingIndex?: number | null
}

export function CreatorsList({
  creators,
  onChange,
  showRequiredAsterisk = false,
  addButtonLabel = "הוספת יוצר נוסף",
  addButtonFullWidth = true,
  onSaveCreator,
  onRemoveCreator,
  savingIndex = null,
}: CreatorsListProps) {
  const updateAt = (i: number, url: string) => {
    const updated = [...creators]
    updated[i] = { ...updated[i], url }
    onChange(updated)
  }

  const removeAt = (i: number) => {
    if (onRemoveCreator) {
      void onRemoveCreator(i)
      return
    }
    onChange(creators.filter((_, j) => j !== i))
  }

  const add = () => {
    const newId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `new-${Date.now()}`
    onChange([...creators, { id: newId, url: "" }])
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        {creators.map((creator, i) => {
          const validationError = validateCreatorInput(creator.url)
          return (
          <div
            key={creator.id ?? `new-${i}`}
            className="group flex flex-col gap-2 rounded-2xl bg-bg-surface px-3 py-2 animate-hook-bump"
          >
            <div className="flex items-start gap-2">
              <span className="text-small text-text-neutral-default whitespace-nowrap select-none pt-2.5">
                קישור ליוצר בנישה שלכם
                {showRequiredAsterisk && (
                  <span className="text-button-destructive-default"> *</span>
                )}
              </span>
              <div className="flex-1 flex flex-col gap-1">
                <Input
                  dir="ltr"
                  value={creator.url}
                  onChange={(e) => updateAt(i, e.target.value)}
                  className={
                    validationError
                      ? "bg-white dark:bg-gray-10 shadow-none ring-1 ring-button-destructive-default focus-visible:ring-button-destructive-default"
                      : "bg-white dark:bg-gray-10 shadow-none"
                  }
                  aria-invalid={validationError ? true : undefined}
                />
                {validationError ? (
                  <p className="text-xs-body text-button-destructive-default px-1">
                    {validationError}
                  </p>
                ) : (
                  <p className="text-xs-body text-text-neutral-default px-1">
                    איסטגרם, טיקטוק או יוטיוב של היוצר
                  </p>
                )}
              </div>
              {creators.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1 mt-2"
                >
                  <Trash2 className="size-4 text-text-neutral-default hover:text-button-destructive-default" />
                </button>
              )}
            </div>

            {onSaveCreator && (
              <Button
                size="sm"
                onClick={() => void onSaveCreator(i)}
                disabled={savingIndex === i || !creator.url.trim() || !!validationError}
                className="self-end mt-1"
              >
                {savingIndex === i && <Loader2 className="size-3.5 animate-spin" />}
                {savingIndex === i ? "שומר..." : "שמור"}
              </Button>
            )}
          </div>
          )
        })}
      </div>

      <Button
        variant="outline"
        onClick={add}
        className={`${addButtonFullWidth ? "w-full h-12 rounded-2xl" : "w-fit"} border-border-neutral-default text-text-neutral-default gap-2`}
      >
        <Plus className="size-4" />
        {addButtonLabel}
      </Button>
    </>
  )
}
