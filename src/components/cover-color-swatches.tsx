"use client"

import Link from "next/link"
import { Check, Palette } from "lucide-react"
import { ColorSwatchPicker } from "@/components/color-swatch-picker"
import { TooltipLabel } from "@/components/ui/tooltip"
import { COVER_FALLBACK_COLOR } from "@/lib/cover-brand-color"

/**
 * Colour control on the talking-head cover card: her brand colours (from
 * Settings → שפה ויזואלית) and black as one-click swatches, plus "+" for any
 * other colour on the existing wheel. The cover opens in her primary brand
 * colour (black when she has none); see lib/cover-brand-color.ts.
 *
 * Swatches are the ColorSwatchPicker swatch as-is (size-7, round, neutral
 * border). Selection is a check mark on the swatch, not a ring: every other
 * selection in the app is a yellow ring, and a yellow ring around a coloured
 * dot reads as a colour of its own.
 */

const SETTINGS_VISUAL_HREF = "/settings?tab=media&sub=visual"
const LABEL = "רקע הכותרת"
const SWATCH =
  "relative size-7 shrink-0 rounded-full border border-border-neutral-default"

interface Props {
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

function Tick({ hex }: { hex: string }) {
  return <Check className={`absolute inset-0 m-auto size-3.5 ${tickClass(hex)}`} strokeWidth={3} aria-hidden />
}

export function CoverColorSwatches({ value, brandColors, onChange, onLivePreview, userId, disabled }: Props) {
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
    <div className="flex flex-col gap-1.5" dir="rtl" data-no-pan>
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
                className={`${SWATCH} cursor-pointer transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50`}
                style={{ backgroundColor: o.hex }}
              >
                {selected && <Tick hex={o.hex} />}
              </button>
            </TooltipLabel>
          )
        })}

        {/* A colour she picked on the wheel shows as its own selected
            swatch, so the row always tells the truth about the cover. */}
        {isCustom && (
          <span role="radio" aria-checked aria-label={`צבע מותאם: ${value}`} className={SWATCH} style={{ backgroundColor: value }}>
            <Tick hex={value} />
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
