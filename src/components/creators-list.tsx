"use client"

import { Plus, Trash2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

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
}

export function CreatorsList({
  creators,
  onChange,
  showRequiredAsterisk = false,
  addButtonLabel = "הוספת יוצר נוסף",
  addButtonFullWidth = true,
}: CreatorsListProps) {
  const updateAt = (i: number, url: string) => {
    const updated = [...creators]
    updated[i] = { ...updated[i], url }
    onChange(updated)
  }

  const removeAt = (i: number) => {
    onChange(creators.filter((_, j) => j !== i))
  }

  const add = () => {
    const newId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `new-${Date.now()}`
    onChange([...creators, { id: newId, url: "" }])
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        {creators.map((creator, i) => (
          <div
            key={creator.id ?? `new-${i}`}
            className="group flex items-center gap-2 rounded-2xl bg-bg-surface px-3 py-2 animate-hook-bump"
          >
            <span className="text-small text-text-neutral-default whitespace-nowrap select-none">
              שם החשבון/יוצר
              {showRequiredAsterisk && (
                <span className="text-button-destructive-default"> *</span>
              )}
            </span>
            <Input
              dir="ltr"
              value={creator.url}
              onChange={(e) => updateAt(i, e.target.value)}
              className="flex-1 bg-white dark:bg-gray-10 shadow-none"
            />
            {creators.length > 1 && (
              <button
                type="button"
                onClick={() => removeAt(i)}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1"
              >
                <Trash2 className="size-4 text-text-neutral-default hover:text-button-destructive-default" />
              </button>
            )}
          </div>
        ))}
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
