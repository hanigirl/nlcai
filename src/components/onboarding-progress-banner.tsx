"use client"

/**
 * OnboardingProgressBanner — a banner placed BELOW the home greeting that tells
 * the user where they are in setup and which files they still owe.
 * Notion task 3714d905 ("באנר התקדמות אונבורדינג").
 *
 * Two conceptually different variants live here, selected by `variant`:
 *   - "a" — compact progress bar + "X מתוך Y" count, with a single highlighted
 *           "next action" row. Low footprint, scan-in-one-glance.
 *   - "b" — segmented named stepper: every stage is a labelled segment with its
 *           own status chip (הושלם / להשלמה), so the user sees the whole map and
 *           exactly which file is missing.
 *
 * This component is presentational only — it receives stages as props and never
 * reads or writes any data source. The home page seeds it with dummy data when
 * a review param is present, so it has ZERO side effects (no API, no DB).
 */

import { Check, ArrowLeft } from "lucide-react"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"

export type OnboardingStage = {
  id: string
  /** Short stage label, plural Hebrew. */
  label: string
  /** One-line description of the file/list this stage covers. */
  description: string
  done: boolean
  /** Where the user goes to complete this stage. */
  href: string
}

export type OnboardingBannerVariant = "a" | "b"

/**
 * The three setup stages, framed around the FILES the user provides — which is
 * the confusion the task names ("לא ברור ... והקבצים שהוא צריך לתת"). The five
 * onboarding steps collapse into three meaningful file-providing stages.
 */
export function makeStages(doneCount: number): OnboardingStage[] {
  const base: Omit<OnboardingStage, "done">[] = [
    {
      id: "connection",
      label: "חיבור החשבון",
      description: "חיברתם את מפתח ה-API שמפעיל את יצירת התוכן.",
      href: "/settings?tab=connections",
    },
    {
      id: "identity",
      label: "זהות העסק וקהל היעד",
      description: "מסמכי העסק וניתוח קהל היעד — הבסיס לכל תוכן שניצור.",
      href: "/settings?tab=business",
    },
    {
      id: "enrichment",
      label: "יוצרים ומוצרים",
      description: "רשימת היוצרים המובילים והמוצרים שלכם — מחדדים את הרעיונות.",
      href: "/settings?tab=creators",
    },
  ]
  return base.map((s, i) => ({ ...s, done: i < doneCount }))
}

function nextStage(stages: OnboardingStage[]): OnboardingStage | undefined {
  return stages.find((s) => !s.done)
}

export function OnboardingProgressBanner({
  variant,
  stages,
}: {
  variant: OnboardingBannerVariant
  stages: OnboardingStage[]
}) {
  const total = stages.length
  const doneCount = stages.filter((s) => s.done).length
  const next = nextStage(stages)
  const allDone = doneCount === total

  if (variant === "a") {
    return <VariantA stages={stages} doneCount={doneCount} total={total} next={next} allDone={allDone} />
  }
  return <VariantB stages={stages} doneCount={doneCount} total={total} next={next} allDone={allDone} />
}

type ViewProps = {
  stages: OnboardingStage[]
  doneCount: number
  total: number
  next: OnboardingStage | undefined
  allDone: boolean
}

/* ------------------------------------------------------------------ */
/* Variant A — compact bar + count + single next-action row           */
/* ------------------------------------------------------------------ */

function VariantA({ stages, doneCount, total, next, allDone }: ViewProps) {
  return (
    <section
      dir="rtl"
      aria-label="התקדמות בהגדרת החשבון"
      className="mb-8 rounded-xl border border-border-neutral-default bg-white dark:bg-gray-10 px-4 py-4 flex flex-col gap-3"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-small-bold text-text-primary-default">
          {allDone ? "סיימתם את ההגדרה — הכל מוכן ליצירה" : "ההגדרה שלכם כמעט מוכנה"}
        </p>
        <span className="text-xs-body text-text-neutral-default shrink-0">
          {doneCount} מתוך {total} שלבים
        </span>
      </div>

      <Progress
        value={(doneCount / total) * 100}
        aria-label={`${doneCount} מתוך ${total} שלבים הושלמו`}
        className="h-2 bg-gray-90 [&>[data-slot=progress-indicator]]:bg-yellow-50"
      />

      {next ? (
        <a
          href={next.href}
          className="group flex items-center justify-between gap-3 rounded-lg bg-bg-surface-primary-default px-3 py-2.5 transition-colors hover:bg-bg-surface-hover"
        >
          <span className="text-small text-text-primary-default">
            <span className="text-small-bold">להשלמה: {next.label}</span>
            <span className="block text-text-neutral-default">{next.description}</span>
          </span>
          <span className="inline-flex items-center gap-1 text-small-bold text-text-primary-default shrink-0">
            להשלמה
            <ArrowLeft className="size-4 transition-transform group-hover:-translate-x-1" />
          </span>
        </a>
      ) : (
        <p className="text-small text-text-neutral-default">
          השלמתם את כל השלבים. אפשר להתחיל ליצור תוכן 🎉
        </p>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Variant B — segmented named stepper with per-stage status chips     */
/* ------------------------------------------------------------------ */

function VariantB({ stages, doneCount, total, next, allDone }: ViewProps) {
  return (
    <section
      dir="rtl"
      aria-label="התקדמות בהגדרת החשבון"
      className="mb-8 rounded-xl border border-border-neutral-default bg-white dark:bg-gray-10 px-4 py-4 flex flex-col gap-4"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-small-bold text-text-primary-default">
          {allDone ? "סיימתם את ההגדרה — הכל מוכן ליצירה" : "איפה אתם בהגדרת החשבון"}
        </p>
        <span className="text-xs-body text-text-neutral-default shrink-0">
          {doneCount} מתוך {total} שלבים
        </span>
      </div>

      {/* Segmented stepper: one row per named stage. */}
      <ol className="flex flex-col gap-2">
        {stages.map((stage) => {
          const isNext = !stage.done && stage.id === next?.id
          return (
            <li key={stage.id}>
              <a
                href={stage.href}
                aria-current={isNext ? "step" : undefined}
                className={cn(
                  "group flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                  stage.done
                    ? "border-border-neutral-default bg-bg-surface"
                    : isNext
                      ? "border-yellow-50 bg-bg-surface-primary-default hover:bg-bg-surface-hover"
                      : "border-border-neutral-default bg-white dark:bg-gray-10 hover:bg-bg-surface",
                )}
              >
                {/* Status indicator */}
                <span
                  aria-hidden
                  className={cn(
                    "inline-flex size-6 shrink-0 items-center justify-center rounded-full",
                    stage.done
                      ? "bg-yellow-50 text-text-primary-default"
                      : "border border-border-neutral-default bg-white dark:bg-gray-10 text-text-neutral-default",
                  )}
                >
                  {stage.done ? <Check className="size-4" /> : null}
                </span>

                <span className="flex flex-col text-right min-w-0 flex-1">
                  <span className="text-small-bold text-text-primary-default">{stage.label}</span>
                  <span className="text-xs-body text-text-neutral-default truncate">{stage.description}</span>
                </span>

                {/* Status chip */}
                {stage.done ? (
                  <span className="text-xs-body text-text-neutral-default shrink-0">הושלם</span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-small-bold text-text-primary-default shrink-0">
                    להשלמה
                    <ArrowLeft className="size-4 transition-transform group-hover:-translate-x-1" />
                  </span>
                )}
              </a>
            </li>
          )
        })}
      </ol>

      {allDone && (
        <p className="text-small text-text-neutral-default">
          השלמתם את כל השלבים. אפשר להתחיל ליצור תוכן 🎉
        </p>
      )}
    </section>
  )
}
