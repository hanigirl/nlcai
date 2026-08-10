/**
 * Google Gemini brand mark — the four-pointed spark, drawn from the official
 * path (simple-icons `googlegemini`), not redrawn by hand.
 *
 * Carries the Gemini gradient rather than a project token: it's someone else's
 * logo, and recolouring it to our palette would make it read as a generic
 * sparkle, which is exactly what it replaced.
 *
 * The gradient id is suffixed per instance — two of these on one page with a
 * shared id would both resolve to whichever <defs> rendered first.
 */
export function GeminiIcon({
  className,
  id = "default",
}: {
  className?: string
  /** Unique per instance when more than one is rendered on a page. */
  id?: string
}) {
  const gradientId = `gemini-gradient-${id}`
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      role="img"
      aria-label="Gemini"
      fill={`url(#${gradientId})`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="24" x2="24" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#4285F4" />
          <stop offset="50%" stopColor="#9B72CB" />
          <stop offset="100%" stopColor="#D96570" />
        </linearGradient>
      </defs>
      <path d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81" />
    </svg>
  )
}
