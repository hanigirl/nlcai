"use client"

import { ErrorScreen } from "@/components/error-screen"

// Route-level error boundary — catches React errors thrown inside any
// route segment under app/. Falls back to the friendly Hebrew screen and
// auto-reports the crash to /api/client-error.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <ErrorScreen error={error} reset={reset} />
}
