"use client"

import { ErrorScreen } from "@/components/error-screen"

// Last-resort boundary — fires when the root layout itself crashes. Must
// render its own <html> + <body> because the broken layout is bypassed.
// Same friendly fallback as the route-level error.tsx.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="he" dir="rtl">
      <body>
        <ErrorScreen error={error} reset={reset} />
      </body>
    </html>
  )
}
