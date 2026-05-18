"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"

// Friendly Hebrew error fallback. Used by both /app/error.tsx (route-level)
// and /app/global-error.tsx (root layout crashes). Auto-reports the crash
// to /api/client-error on mount so we always get a stack trace + the user's
// session in Vercel logs, even when the user doesn't click anything.
//
// Behavior:
//   - Refresh button → Next's reset() to try the same view again
//   - Home button   → hard nav to "/", escapes broken route state
//   - "Report" link → mailto with prefilled digest so we get a direct line
export function ErrorScreen({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset?: () => void
}) {
  useEffect(() => {
    const body = {
      message: error.message,
      stack: error.stack,
      digest: error.digest,
      url: typeof window !== "undefined" ? window.location.href : null,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    }
    // keepalive lets the POST survive even if React unmounts mid-flight.
    fetch("/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => { /* swallow — the reporter must never re-throw */ })
  }, [error])

  const mailtoBody = encodeURIComponent(
    `שלום,\n\nנתקלתי בשגיאה באתר.\n\nקוד זיהוי: ${error.digest ?? "—"}\nכתובת: ${typeof window !== "undefined" ? window.location.href : ""}\nהודעה: ${error.message || "—"}\n\nתודה!`,
  )
  const mailtoSubject = encodeURIComponent("שגיאה באתר — בקשת תמיכה")

  return (
    <div dir="rtl" className="min-h-screen bg-bg-surface flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-md rounded-2xl border border-border-neutral-default bg-white dark:bg-gray-10 shadow-[0_8px_24px_rgba(0,0,0,0.06)] p-8 flex flex-col items-center text-center gap-5">
        <h1 className="text-display text-text-primary-default leading-tight">
          אויש.. לעזאזל..
          <br />
          משהו בלתי צפוי קרה
        </h1>

        <p className="text-p text-text-primary-default">
          נסו לרענן את העמוד, ואם זה לא עוזר — שלחו לנו את ההודעה הזו.
        </p>

        <p className="text-xs-body text-text-neutral-default">
          יא אללה איזה באסה!
        </p>

        <div className="flex flex-col w-full gap-2 mt-2">
          <Button
            onClick={() => (reset ? reset() : window.location.reload())}
            className="bg-button-primary-default hover:bg-button-primary-hover text-white"
          >
            לרענן את העמוד
          </Button>
          <a
            href={`mailto:hanigirl@gmail.com?subject=${mailtoSubject}&body=${mailtoBody}`}
            className="text-small text-text-neutral-default hover:text-text-primary-default underline underline-offset-4"
          >
            שלחו לנו את הפרטים
          </a>
        </div>

        {error.digest && (
          <p className="text-xs-body text-text-neutral-default mt-2 select-all">
            קוד זיהוי: {error.digest}
          </p>
        )}
      </div>
    </div>
  )
}
