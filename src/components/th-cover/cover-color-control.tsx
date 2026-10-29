"use client"

import Link from "next/link"
import { Check, Palette, RotateCcw } from "lucide-react"
import { ColorSwatchPicker } from "@/components/color-swatch-picker"
import { TooltipLabel } from "@/components/ui/tooltip"
import { COVER_FALLBACK_COLOR, defaultCoverColor } from "@/lib/cover-brand-color"

/**
 * The colour control on the talking-head cover card (design review
 * ?thcover=a|b). Both variants open with her primary brand colour already
 * applied (black when she has none) and keep the free colour wheel — they
 * differ in how the brand colour is PRESENTED:
 *
 *   A — "פלטת המותג על הכרטיס": her brand colours sit on the card as
 *       one-click swatches, next to black and a "+" for any other colour.
 *       Choice-first: the brand palette IS the control.
 *   B — "צבע אחד עם מקור": the single swatch stays as today, with a line
 *       under it that says where the colour came from and a one-click way
 *       back to the brand colour after she changed it.
 *       Provenance-first: the control stays minimal, the default explains
 *       itself.
 */

export type CoverColorVariant = "a" | "b"

const SETTINGS_VISUAL_HREF = "/settings?tab=media&sub=visual"
const LABEL = "רקע הכותרת"

interface Props {
  variant: CoverColorVariant
  value: string
  brandColors: string[]
  onChange: (color: string) => void
  onLivePreview?: (color: string | null) => void
  userId: string | null
  disabled?: boolean
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** Check-mark colour that reads on a given swatch (light swatch → dark tick). */
function tickClass(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  return lum > 0.6 ? "text-gray-10" : "text-white"
}

export function CoverColorControl(props: Props) {
  return props.variant === "a" ? <BrandPaletteRow {...props} /> : <SourcedSwatch {...props} />
}

/* ------------------------------------------------------------------ A -- */

function BrandPaletteRow({ value, brandColors, onChange, onLivePreview, userId, disabled }: Props) {
  // Her brand colours first, then black as the neutral fallback (once).
  const options = [
    ...brandColors.map((hex, i) => ({ hex, label: i === 0 ? "צבע מותג ראשי" : "צבע מותג" })),
    ...(brandColors.some((c) => same(c, COVER_FALLBACK_COLOR)) ? [] : [{ hex: COVER_FALLBACK_COLOR, label: "שחור" }]),
  ]
  const isCustom = !options.some((o) => same(o.hex, value))

  const pick = (hex: string) => {
    if (disabled || same(hex, value)) return
    // Same overlay hand-off the wheel uses: paint the new colour now, the
    // host drops the overlay once the regenerated PNG lands.
    onLivePreview?.(hex)
    onChange(hex)
  }

  return (
    <div className="flex flex-col gap-1.5" dir="rtl" data-no-pan data-thcover-control>
      <span className="text-small text-text-primary-default">{LABEL}</span>
      <div className="flex items-center gap-2" role="radiogroup" aria-label={LABEL}>
        {options.map((o) => {
          const selected = same(o.hex, value)
          return (
            <TooltipLabel key={o.hex} label={o.label}>
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={`${o.label}: ${o.hex}`}
                disabled={disabled}
                onClick={() => pick(o.hex)}
                className={`relative size-7 shrink-0 rounded-full border border-border-neutral-default cursor-pointer transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 ${
                  selected ? "ring-2 ring-text-primary-default ring-offset-2 ring-offset-white dark:ring-offset-gray-10" : ""
                }`}
                style={{ backgroundColor: o.hex }}
              >
                {selected && <Check className={`absolute inset-0 m-auto size-3.5 ${tickClass(o.hex)}`} strokeWidth={3} aria-hidden />}
              </button>
            </TooltipLabel>
          )
        })}

        {/* Her own pick that isn't in the palette shows as a selected swatch
            of its own, so the row always tells the truth about the cover. */}
        {isCustom && (
          <span
            role="radio"
            aria-checked
            aria-label={`צבע מותאם: ${value}`}
            className="relative size-7 shrink-0 rounded-full border border-border-neutral-default ring-2 ring-text-primary-default ring-offset-2 ring-offset-white dark:ring-offset-gray-10"
            style={{ backgroundColor: value }}
          >
            <Check className={`absolute inset-0 m-auto size-3.5 ${tickClass(value)}`} strokeWidth={3} aria-hidden />
          </span>
        )}

        <span className="mx-0.5 h-5 w-px bg-border-neutral-default" aria-hidden />
        <TooltipLabel label="צבע אחר">
          <span>
            <ColorSwatchPicker
              value={value}
              onChange={onChange}
              onLivePreview={onLivePreview}
              userId={userId}
              label="צבע אחר"
              trigger="custom"
            />
          </span>
        </TooltipLabel>

        {brandColors.length === 0 && (
          <TooltipLabel label="הוספת צבע מותג">
            <Link
              href={SETTINGS_VISUAL_HREF}
              aria-label="הוספת צבע מותג"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed border-border-neutral-default text-text-neutral-default transition-colors hover:bg-gray-95 hover:text-text-primary-default dark:hover:bg-gray-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
            >
              <Palette className="size-3.5" />
            </Link>
          </TooltipLabel>
        )}
      </div>
      {brandColors.length === 0 && (
        <p className="text-xs text-text-neutral-default">
          עדיין לא הגדרתם צבע מותג, אז הרקע שחור.{" "}
          <Link href={SETTINGS_VISUAL_HREF} className="font-semibold text-text-primary-default underline underline-offset-2">
            הגדרת צבע מותג
          </Link>
        </p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ B -- */

function SourcedSwatch({ value, brandColors, onChange, onLivePreview, userId, disabled }: Props) {
  const brand = brandColors.length > 0 ? defaultCoverColor(brandColors) : null
  const onBrand = brand !== null && same(value, brand)

  return (
    <div className="flex flex-col gap-1" dir="rtl" data-no-pan data-thcover-control>
      <ColorSwatchPicker
        value={value}
        onChange={onChange}
        onLivePreview={onLivePreview}
        userId={userId}
        label={LABEL}
      />
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-text-neutral-default" aria-live="polite">
        {onBrand && (
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <span className="size-2 rounded-full" style={{ backgroundColor: brand! }} aria-hidden />
            צבע המותג שלכם
          </span>
        )}
        {brand !== null && !onBrand && (
          <>
            <span className="whitespace-nowrap">צבע מותאם</span>
            <span aria-hidden>·</span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                onLivePreview?.(brand)
                onChange(brand)
              }}
              className="inline-flex items-center gap-1 whitespace-nowrap font-semibold text-text-primary-default underline underline-offset-2 disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 rounded"
            >
              <RotateCcw className="size-3" aria-hidden />
              חזרה לצבע המותג
            </button>
          </>
        )}
        {brand === null && (
          <>
            <span className="whitespace-nowrap">אין צבע מותג</span>
            <span aria-hidden>·</span>
            <Link href={SETTINGS_VISUAL_HREF} className="whitespace-nowrap font-semibold text-text-primary-default underline underline-offset-2">
              הגדרת צבע מותג
            </Link>
          </>
        )}
      </p>
    </div>
  )
}
