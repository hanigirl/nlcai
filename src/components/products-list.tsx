"use client"

import { Plus, Trash2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

export type ProductType = "front" | "premium" | "lead_magnet"

export interface ProductEntry {
  id?: string
  name: string
  type: ProductType
  landingPageUrl: string
  pageSummary?: string | null
}

interface ProductsListProps {
  products: ProductEntry[]
  onChange: (products: ProductEntry[]) => void
  requireName?: boolean
  addButtonLabel?: string
}

export function ProductsList({
  products,
  onChange,
  requireName = false,
  addButtonLabel = "הוספת מוצר חדש",
}: ProductsListProps) {
  const updateAt = (i: number, patch: Partial<ProductEntry>) => {
    const updated = [...products]
    updated[i] = { ...updated[i], ...patch }
    onChange(updated)
  }

  const removeAt = (i: number) => {
    onChange(products.filter((_, j) => j !== i))
  }

  const add = () => {
    onChange([
      ...products,
      {
        id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : undefined,
        name: "",
        type: "front",
        landingPageUrl: "",
      },
    ])
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        {products.map((product, i) => (
          <div
            key={product.id ?? `new-${i}`}
            className="group flex flex-col gap-2 rounded-2xl bg-bg-surface px-3 py-3 animate-hook-bump"
          >
            <div className="flex items-center gap-2">
              <span className="text-small text-text-neutral-default whitespace-nowrap select-none">
                שם המוצר
                {requireName && (
                  <span className="text-button-destructive-default"> *</span>
                )}
              </span>
              <Input
                value={product.name}
                onChange={(e) => updateAt(i, { name: e.target.value })}
                required={requireName}
                className="flex-1 bg-white dark:bg-gray-10 shadow-none"
              />

              <select
                value={product.type}
                onChange={(e) => updateAt(i, { type: e.target.value as ProductType })}
                className="h-10 rounded-xl border border-border-neutral-default bg-white dark:bg-gray-10 px-3 text-small text-text-primary-default appearance-none cursor-pointer pe-8"
                style={{
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23808080' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "left 0.5rem center",
                }}
              >
                <option value="front">פרונט</option>
                <option value="premium">פרימיום</option>
                <option value="lead_magnet">מגנט לידים</option>
              </select>

              <button
                type="button"
                onClick={() => removeAt(i)}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1"
              >
                <Trash2 className="size-4 text-text-neutral-default hover:text-button-destructive-default" />
              </button>
            </div>

            <Input
              dir="ltr"
              placeholder="לינק לדף המוצר (אופציונלי)"
              value={product.landingPageUrl}
              onChange={(e) => updateAt(i, { landingPageUrl: e.target.value })}
              className="bg-white dark:bg-gray-10 shadow-none text-sm"
            />

            {product.pageSummary && (
              <p className="text-xs text-text-neutral-default px-1">{product.pageSummary}</p>
            )}
          </div>
        ))}
      </div>

      <Button
        variant="outline"
        onClick={add}
        className="w-full h-12 rounded-2xl border-border-neutral-default text-text-neutral-default gap-2"
      >
        <Plus className="size-4" />
        {addButtonLabel}
      </Button>
    </>
  )
}
