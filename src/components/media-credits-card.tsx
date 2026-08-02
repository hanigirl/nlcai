"use client"

import Link from "next/link"
import { CircleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Shown in the media panel INSTEAD of the "generate with AI" card when the
 * user has no OpenAI key connected. The OpenAI key is optional in onboarding,
 * so this is the state a student lands in when they skipped it — the card
 * explains why the one-click generation isn't there and hands them the way to
 * turn it on, rather than showing a button that can only fail.
 *
 * It never replaces the Google Drive path: every panel keeps its "או" + import
 * affordance underneath, because bringing your own media still works with no
 * OpenAI key at all.
 *
 * Sits in the same slot as the AI cards in media-panel.tsx, so it copies their
 * box (same radius, border, padding, centered stack) — see the completion
 * report for the 1px padding difference vs. the Figma frame.
 */
export function MediaCreditsCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        // Pale red in light mode as designed; in dark mode the same red at low
        // opacity, because a solid red-95 block under near-white text would be
        // unreadable (the text tokens flip, the design's fill doesn't).
        "flex flex-col items-center gap-3 rounded-[18px] border border-border-neutral-default bg-red-95 px-6 py-4 dark:bg-red-95/10",
        className,
      )}
    >
      <CircleAlert
        className="size-[23px] shrink-0 text-text-primary-default"
        aria-hidden
      />
      <p className="text-center text-small font-semibold text-text-primary-default">
        אין קרדיטים זמינים לג׳ינרוט מדיה עם AI
      </p>
      <p className="text-center text-xs leading-relaxed text-text-neutral-default">
        כדי לג׳נרט מדיה בלחיצה
        <br />
        יש לחבר קרדיטים למודל התמונות של chatGPT
      </p>
      <Button
        size="sm"
        asChild
        className={cn(
          // No semantic token lands on this soft-danger fill (button-danger is
          // red-60, far stronger), so it's the red-80/red-70 primitives with
          // the near-black text the design specifies. Dark mode steps down to
          // the stronger red so white text can carry it.
          "w-full border-transparent bg-red-80 text-gray-10 hover:bg-red-70",
          "dark:bg-red-60 dark:text-white dark:hover:bg-red-50",
        )}
      >
        <Link href="/settings?tab=connections&sub=openai">להגדרות</Link>
      </Button>
    </div>
  )
}
