"use client"

/**
 * State preview for dragging the project canvas with a finger.
 *
 * Route: /test/canvas-touch — the real InfiniteCanvas with the same two cards
 * /project shows after writing an idea (the idea card + "בחירת הוק"), laid
 * out exactly as on /project. Open it on a phone (or the browser's phone
 * mode): one finger drags the canvas, two fingers pinch-zoom. Before the fix
 * a finger did nothing, so on a phone the hooks card sat off-screen for good
 * (bug report 2026-11-22). No fetches, no DB.
 *
 *   ?state=idea  — an idea was just written; the "תייצר לי הוקים" button is
 *                  on the hooks card, off-screen to the left on a phone
 *   ?state=hooks — hooks already generated, the list to pick from
 *   (no param)   — both, one above the other
 */

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { Sparkles } from "lucide-react"
import { InfiniteCanvas } from "@/components/infinite-canvas"
import { SelectionCard } from "@/components/selection-card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

const SAMPLE_IDEA =
  "סרטון שבו אני מראה הדרגתיות של תרגול לקראת קפיצה, למי שיש בעיות ברצפת אגן. המשך קל יותר לסרטון הקפיצות הקודם."

const SAMPLE_HOOKS = [
  "קפיצה אחת שלא הצלחתן לעשות בלי לדלוף? בואו נתחיל ממנה",
  "לא צריך לוותר על קפיצות בגלל רצפת האגן",
  "שלושה שלבים לפני שאתן חוזרות לקפוץ",
]

type State = "idea" | "hooks"

function IdeaFlow({ state }: { state: State }) {
  const hooks = state === "hooks" ? SAMPLE_HOOKS : []
  return (
    <InfiniteCanvas>
      <div className="flex items-start gap-0 pt-24 pr-24" dir="rtl">
        <div
          dir="rtl"
          className="flex flex-col gap-3 rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 pb-6 w-[346px] shrink-0"
        >
          <div className="flex items-center px-6 py-3 rounded-t-[20px] bg-bg-surface-primary-default-80">
            <span className="text-p-bold text-text-primary-default">רעיון</span>
          </div>
          <div className="px-6">
            <div className="rounded-lg p-2 transition-colors focus-within:bg-gray-95">
              <Textarea
                defaultValue={SAMPLE_IDEA}
                placeholder="כתבו או ערכו את הרעיון..."
                className="min-h-[120px] text-small text-text-primary-default border-none bg-transparent shadow-none p-0 resize-none focus-visible:ring-0"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center mt-[55px]">
          <div className="h-[2px] w-7 bg-gray-80" />
        </div>

        <div
          dir="rtl"
          className="flex flex-col gap-3 rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 pb-6 w-[567px] shrink-0"
        >
          <div className="flex items-center px-6 py-3 rounded-t-[20px] bg-bg-surface">
            <span className="text-p-bold text-text-primary-default">בחירת הוק</span>
          </div>
          {hooks.length === 0 ? (
            <div className="flex justify-center px-6 py-4">
              <Button size="sm" className="gap-1.5" data-testid="generate-hooks">
                <Sparkles className="size-3.5" />
                תייצר לי הוקים
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 px-6">
              {hooks.map((hook) => (
                <SelectionCard key={hook} description={hook} isSelected={false} onSelect={() => {}} />
              ))}
            </div>
          )}
        </div>
      </div>
    </InfiniteCanvas>
  )
}

function Preview() {
  const param = useSearchParams().get("state")
  const states: State[] = param === "idea" || param === "hooks" ? [param] : ["idea", "hooks"]
  return (
    <div className="flex h-dvh flex-col bg-bg-surface">
      {states.map((s) => (
        <div key={s} className="relative min-h-0 flex-1 border-b border-border-neutral-default">
          <IdeaFlow state={s} />
        </div>
      ))}
    </div>
  )
}

export default function CanvasTouchPreview() {
  return (
    <Suspense fallback={null}>
      <Preview />
    </Suspense>
  )
}
