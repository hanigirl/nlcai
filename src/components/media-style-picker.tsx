"use client"

import { useState } from "react"
import { getTemplate, type TemplateConfig } from "@/lib/carousel-templates"
import { useBrandCarouselTemplate } from "@/hooks/use-brand-carousel-template"
import type { MediaStyle } from "@/lib/visual-language/types"

/**
 * Style picker for AI image post / story / b-roll — the same grid as the
 * carousel templates: her own visual language (when analysed), or her
 * niche's language in a dark or light version. (A separate plain "niche"
 * tile was dropped — Hani: dark and light already ARE the niche language.)
 *
 * Default: her visual language when she has one, otherwise the light niche
 * version — until she taps a tile herself.
 */
export function useMediaStyle(): {
  style: MediaStyle
  setStyle: (s: MediaStyle) => void
  brandTemplate: TemplateConfig | null
} {
  const brandTemplate = useBrandCarouselTemplate()
  const [picked, setPicked] = useState<MediaStyle | null>(null)
  const style: MediaStyle = picked ?? (brandTemplate ? "brand" : "ai-light")
  return { style, setStyle: setPicked, brandTemplate }
}

export function MediaStylePicker({
  value,
  onChange,
  brandTemplate,
  label = "סגנון",
  aspect = "9/16",
}: {
  value: MediaStyle
  onChange: (s: MediaStyle) => void
  brandTemplate: TemplateConfig | null
  label?: string
  /** Tile shape — the format's own: 9/16 story & b-roll, 4/5 image post. */
  aspect?: "9/16" | "4/5"
}) {
  const dark = getTemplate("ai-dark")
  const light = getTemplate("ai-light")
  const options: { id: MediaStyle; name: string; thumb: React.ReactNode }[] = [
    ...(brandTemplate
      ? [
          {
            id: "brand" as const,
            name: brandTemplate.name,
            thumb: brandTemplate.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brandTemplate.thumbnailUrl} alt="" className="size-full object-cover" />
            ) : (
              <div
                className="size-full flex flex-col justify-center gap-1 p-2"
                style={{ backgroundColor: brandTemplate.preview.bg }}
              >
                <span className="h-1.5 w-4/5 rounded-full" style={{ backgroundColor: brandTemplate.preview.titleColor }} />
                <span className="h-1.5 w-3/5 rounded-full" style={{ backgroundColor: brandTemplate.preview.accent }} />
              </div>
            ),
          },
        ]
      : []),
    ...[dark, light]
      .filter((t): t is TemplateConfig => !!t)
      .map((t) => ({
        id: t.id as MediaStyle,
        name: t.name,
        // Dark / light = her niche's language on that canvas; the tile only
        // sketches the tone.
        thumb: (
          <div className="size-full flex flex-col justify-center gap-1 p-2" style={{ backgroundColor: t.preview.bg }}>
            <span className="h-1.5 w-4/5 rounded-full" style={{ backgroundColor: t.preview.titleColor }} />
            <span className="h-1.5 w-3/5 rounded-full" style={{ backgroundColor: t.preview.accent }} />
          </div>
        ),
      })),
  ]

  return (
    <div className="flex w-full flex-col gap-1.5">
      <p className="text-xs text-text-neutral-default">{label}</p>
      <div role="radiogroup" aria-label={label} className="grid grid-cols-3 gap-1.5">
        {options.map((o) => {
          const selected = value === o.id
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(o.id)}
              className={`flex flex-col gap-1 rounded-lg border p-1 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 ${
                selected ? "border-yellow-50 ring-1 ring-yellow-50" : "border-border-neutral-default hover:border-gray-80"
              }`}
            >
              <div className={`${aspect === "4/5" ? "aspect-[4/5]" : "aspect-[9/16]"} w-full overflow-hidden rounded-md`}>
                {o.thumb}
              </div>
              <span className="line-clamp-3 text-center text-[11px] leading-tight text-text-primary-default">
                {o.name}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
