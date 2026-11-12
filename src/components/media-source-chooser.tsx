"use client"

import { useState } from "react"
import Link from "next/link"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { TemplateConfig } from "@/lib/carousel-templates"

/**
 * "הוספת מדיה לסקריפט" (Hani, 2026-11-10 — Figma 711:2289): the media tab's
 * first step on the new panel. Two tiles — her visual language (AI makes new
 * media) or her own media (we only add the script's text) — then one
 * "המשך" button. Existing media opens the Drive gallery (step 2, as today);
 * her language generates straight away. Same tile shape as MediaStylePicker.
 */
export type MediaSource = "existing" | "ai"

const CONTINUE_LABEL: Record<string, string> = {
  image_post: "המשך ליצירת תמונה",
  carousel: "המשך ליצירת קרוסלה",
  story: "המשך ליצירת סטורי",
  b_roll: "המשך ליצירת בי-רול",
}

export function MediaSourceChooser({
  format,
  brandTemplate,
  brandLoading = false,
  aspect = "9/16",
  busy = false,
  disabled = false,
  onExisting,
  onAi,
}: {
  format: string
  brandTemplate: TemplateConfig | null
  brandLoading?: boolean
  /** The format's own tile shape: 4/5 image post & carousel, 9/16 story & b-roll. */
  aspect?: "9/16" | "4/5"
  /** A generation for this format is running. */
  busy?: boolean
  disabled?: boolean
  onExisting: () => void
  onAi: () => void
}) {
  const [source, setSource] = useState<MediaSource>("existing")
  const ratio = aspect === "4/5" ? "aspect-[4/5]" : "aspect-[9/16]"
  // No visual language yet → the AI tile is off and says where to set one
  // (Hani, 2026-11-12: it rendered something unknown without one).
  const noLanguage = !brandLoading && !brandTemplate

  const tiles: { id: MediaSource; title: string; sub: string; thumb: React.ReactNode }[] = [
    {
      id: "existing",
      title: "שימוש במדיה קיימת",
      sub: "אנחנו רק נוסיף טקסט",
      thumb: (
        <div className="flex size-full items-center justify-center rounded-md border border-gray-80 bg-white dark:bg-gray-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/google-drive.svg" alt="" className="size-4 shrink-0" />
        </div>
      ),
    },
    {
      id: "ai",
      title: "השפה הויזואלית שלך",
      sub: "נייצר מדיה חדשה עם AI",
      thumb:
        brandLoading && !brandTemplate ? (
          <Skeleton className="size-full rounded-md" />
        ) : brandTemplate?.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={brandTemplate.thumbnailUrl} alt="" className="size-full object-cover" />
        ) : (
          <div
            className="flex size-full flex-col justify-center gap-1 p-2"
            style={{ backgroundColor: brandTemplate?.preview.bg ?? "#f2f2f2" }}
          >
            <span className="h-1.5 w-4/5 rounded-full" style={{ backgroundColor: brandTemplate?.preview.titleColor ?? "#ccc" }} />
            <span className="h-1.5 w-3/5 rounded-full" style={{ backgroundColor: brandTemplate?.preview.accent ?? "#e6e6e6" }} />
          </div>
        ),
    },
  ]

  return (
    <div className="flex flex-col gap-5 rounded-[18px] border border-border-neutral-default bg-white px-6 py-4 dark:bg-gray-10">
      <div className="flex flex-col text-text-primary-default">
        <p className="text-small-bold">הוספת מדיה לסקריפט</p>
        <p className="text-xs-body">איך ניצור את המדיה לטקסט?</p>
      </div>

      <div role="radiogroup" aria-label="איך ניצור את המדיה" className="grid grid-cols-2 gap-1.5">
        {tiles.map((t) => {
          const off = t.id === "ai" && noLanguage
          const selected = source === t.id && !off
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-disabled={off || undefined}
              disabled={off}
              onClick={() => setSource(t.id)}
              className={`flex w-full flex-col gap-1 rounded-[10px] border p-1 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 ${
                off
                  ? "cursor-not-allowed border-border-neutral-default opacity-50"
                  : selected
                    ? "cursor-pointer border-yellow-50 ring-1 ring-yellow-50"
                    : "cursor-pointer border-border-neutral-default hover:border-gray-80"
              }`}
            >
              <div className={`${ratio} w-full overflow-hidden rounded-md`}>{t.thumb}</div>
              <span className="flex flex-col gap-0.5 pb-1 text-center text-text-primary-default">
                <span className="text-xs font-semibold leading-tight">{t.title}</span>
                <span className="text-[10px] leading-tight">{t.sub}</span>
              </span>
            </button>
          )
        })}
      </div>

      {noLanguage && (
        <div role="status" className="flex flex-col items-start gap-1 rounded-lg bg-bg-surface-warning-default p-3">
          <p className="text-small-bold text-text-primary-default">עדיין לא הגדרת שפת מותג</p>
          <p className="text-xs-body text-gray-40 dark:text-gray-80">
            שפת מותג עוזרת לייצר פוסטים שמעוצבים בצבעים, פונטים ואלמנטים מהמותג שלך
          </p>
          <Link
            href="/settings?tab=media&sub=visual"
            className="mt-1 rounded text-xs-body font-semibold text-button-primary-default underline underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
          >
            להגדרות שפת מותג
          </Link>
        </div>
      )}

      <Button
        onClick={() => (source === "ai" && !noLanguage ? onAi() : onExisting())}
        disabled={disabled || busy || (source === "ai" && brandLoading)}
        className="w-full gap-1.5"
      >
        {busy && <Loader2 className="size-3.5 animate-spin" />}
        {CONTINUE_LABEL[format] ?? "המשך"}
      </Button>
    </div>
  )
}
