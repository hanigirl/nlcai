"use client"

import { useEffect, useState } from "react"
import { Plus } from "lucide-react"
import { getTemplate, type TemplateConfig } from "@/lib/carousel-templates"
import { useBrandCarouselTemplateState } from "@/hooks/use-brand-carousel-template"
import { Skeleton } from "@/components/ui/skeleton"
import { AiHoverEditButton } from "@/components/ai-hover-edit"
import { isMediaStyle, type MediaStyle } from "@/lib/visual-language/types"
import { getFormatMeta, setFormatMeta, type FormatId } from "@/lib/timing-storage"

/**
 * Style picker for AI image post / story / b-roll — the same grid as the
 * carousel templates: her own visual language (when analysed), or her
 * niche's language in a dark or light version. (A separate plain "niche"
 * tile was dropped — Hani: dark and light already ARE the niche language.)
 *
 * Default: her visual language when she has one, otherwise the light niche
 * version — until she taps a tile herself.
 */
export function useMediaStyle(postId?: string | null, format?: FormatId): {
  style: MediaStyle
  setStyle: (s: MediaStyle) => void
  brandTemplate: TemplateConfig | null
  /** Her visual language is still being looked up. */
  brandLoading: boolean
} {
  const { template: brandTemplate, loading: brandLoading } = useBrandCarouselTemplateState()
  // The style this format's media was made in, or her pick since — kept with
  // the post's format meta, so closing and reopening the panel (a remount)
  // never falls back to her visual language (Hani, 2026-11-06).
  const remembered = () => {
    const s = postId && format ? getFormatMeta(postId, format).mediaStyle : undefined
    return isMediaStyle(s) ? s : null
  }
  const [picked, setPicked] = useState<MediaStyle | null>(remembered)
  useEffect(() => {
    setPicked(remembered())
    // A different post / format: its own remembered style.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId, format])
  const setStyle = (s: MediaStyle) => {
    setPicked(s)
    if (postId && format) setFormatMeta(postId, format, { mediaStyle: s })
  }
  // While it loads, nothing jumps: her language is the expected default.
  const style: MediaStyle = picked ?? (brandTemplate || brandLoading ? "brand" : "ai-light")
  return { style, setStyle, brandTemplate, brandLoading }
}

/**
 * The "חדש לגמרי" tile's picture: a blank page — the tile is a style with no
 * style. Shared by this picker and the carousel template grid.
 */
export function BlankTileThumb({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`flex items-center justify-center rounded-md border border-dashed border-gray-80 bg-white dark:bg-gray-10 ${className}`}
      style={style}
    >
      <Plus className="size-4 text-text-neutral-default" aria-hidden />
    </div>
  )
}

export function MediaStylePicker({
  value,
  onChange,
  brandTemplate,
  brandLoading = false,
  label = "סגנון",
  aspect = "9/16",
  onAiEdit,
}: {
  value: MediaStyle
  onChange: (s: MediaStyle) => void
  brandTemplate: TemplateConfig | null
  /** Hold a loading tile in her visual language's place. */
  brandLoading?: boolean
  label?: string
  /** Tile shape — the format's own: 9/16 story & b-roll, 4/5 image post. */
  aspect?: "9/16" | "4/5"
  /**
   * "עריכה עם AI" on the picked tile (Hani, 2026-11-05): the same sparkle as
   * on finished media. Before there is media it means "talk first, then
   * generate in this style" — the AI panel opens on a question about it.
   * Always shown on the picked tile, not only on hover.
   */
  onAiEdit?: () => void
}) {
  const dark = getTemplate("ai-dark")
  const light = getTemplate("ai-light")
  const options: { id: MediaStyle; name: string; thumb: React.ReactNode }[] = [
    // "חדש לגמרי" first (Hani, 2026-11-05): from her brief, no style at all.
    { id: "blank", name: "חדש לגמרי", thumb: <BlankTileThumb className="size-full" /> },
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
      <div role="radiogroup" aria-label={label} aria-busy={brandLoading && !brandTemplate} className="grid grid-cols-2 gap-1.5 group/ai">
        {brandLoading && !brandTemplate && (
          <div className="flex flex-col gap-1 rounded-lg border border-border-neutral-default p-1" aria-hidden>
            <Skeleton className={`${aspect === "4/5" ? "aspect-[4/5]" : "aspect-[9/16]"} w-full rounded-md`} />
            <Skeleton className="mx-auto h-3 w-3/4 rounded" />
          </div>
        )}
        {options.map((o) => {
          const selected = value === o.id
          return (
            <div key={o.id} className="relative">
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(o.id)}
              className={`flex w-full flex-col gap-1 rounded-lg border p-1 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 ${
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
            {selected && onAiEdit && (
              // Above the tile's name.
              <AiHoverEditButton target="media" className="bottom-7" visible onClick={onAiEdit} />
            )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
