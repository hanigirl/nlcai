"use client"

/**
 * REVIEW SCAFFOLDING — delete this whole file when a direction is picked.
 *
 * Lets a reviewer jump between the notice's states without having to drive the
 * page into them. Direction A closes the card outright, so without this there
 * is no way back short of a reload; direction B leaves a chip, but the toggle
 * keeps the two links behaving the same way so they can be compared fairly.
 *
 * Renders only when the `?close=a|b` gate is on, so it can never reach a user.
 */
export function GeminiNoticeReviewToggle({
  variant,
  dismissed,
  onChange,
}: {
  variant: "a" | "b"
  dismissed: boolean
  onChange: (dismissed: boolean) => void
}) {
  const label =
    variant === "a"
      ? "כיוון א׳ — סגירה לסשן"
      : "כיוון ב׳ — כיווץ לצ׳יפ"
  const closedLabel = variant === "a" ? "אחרי סגירה" : "מכווץ"

  return (
    <div
      dir="rtl"
      className="fixed bottom-6 left-6 z-50 flex items-center gap-2 rounded-full border border-border-neutral-default bg-white dark:bg-gray-10 px-3 py-2 shadow-lg"
    >
      <span className="text-xs-body text-text-neutral-default">{label}</span>
      <span className="h-4 w-px bg-border-neutral-default" aria-hidden />
      <button
        type="button"
        onClick={() => onChange(false)}
        aria-pressed={!dismissed}
        className={`rounded-full px-3 py-1 text-xs-body transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 ${
          dismissed
            ? "text-text-neutral-default hover:bg-gray-95 dark:hover:bg-gray-20"
            : "bg-bg-surface-primary-default text-text-primary-default"
        }`}
      >
        פתוחה
      </button>
      <button
        type="button"
        onClick={() => onChange(true)}
        aria-pressed={dismissed}
        className={`rounded-full px-3 py-1 text-xs-body transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 ${
          dismissed
            ? "bg-bg-surface-primary-default text-text-primary-default"
            : "text-text-neutral-default hover:bg-gray-95 dark:hover:bg-gray-20"
        }`}
      >
        {closedLabel}
      </button>
    </div>
  )
}
