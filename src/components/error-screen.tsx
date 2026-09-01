"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"

// Friendly Hebrew error fallback. Used by both /app/error.tsx (route-level)
// and /app/global-error.tsx (root layout crashes). Auto-reports the crash
// to /api/client-error on mount so we always get a stack trace + the user's
// session in Vercel logs, even when the user doesn't click anything.
//
// Behavior:
//   - One silent auto-retry first — most crashes here are a transient DOM
//     race, and a student should never have to read an error screen for one
//   - Refresh button → Next's reset() to try the same view again
//   - "Report" link → mailto with prefilled digest so we get a direct line
//   - Browser-translation crashes get their own copy, because reset() cannot
//     fix those and telling the student to refresh just loops her

// React's reconciler failing because something outside React moved the nodes
// it was holding. In production this is the browser's translate feature
// rewriting the Hebrew page mid-render — never our own code — so the fix is
// "turn translation off", not "refresh".
function isTranslationCrash(error: Error): boolean {
  const m = error.message || ""
  return (
    (m.includes("removeChild") || m.includes("insertBefore")) &&
    m.includes("not a child of this node")
  )
}

// One retry per view, not per mount: reset() re-mounts this component, so a
// counter in state would reset with it and loop forever. sessionStorage
// survives the re-mount and dies with the tab. The timestamp lets a page that
// stayed healthy for a while earn its retry back — otherwise a student who
// crashed once at 09:00 gets no auto-recovery for the rest of the day.
const RETRY_KEY = "nlcai:error-auto-retry"
const RETRY_WINDOW_MS = 60_000

function retryAvailable(): boolean {
  try {
    const raw = sessionStorage.getItem(RETRY_KEY)
    if (!raw) return true
    const { at } = JSON.parse(raw) as { at: number }
    return Date.now() - at >= RETRY_WINDOW_MS
  } catch {
    // Private mode, or storage disabled. Skipping the retry is the safe
    // failure — a loop is far worse than one error screen.
    return false
  }
}

function markRetryUsed(): void {
  try {
    sessionStorage.setItem(RETRY_KEY, JSON.stringify({ at: Date.now() }))
  } catch { /* see above — no storage means no auto-retry, which is fine */ }
}

export function ErrorScreen({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset?: () => void
}) {
  const translationCrash = isTranslationCrash(error)

  // "deciding" renders nothing for the frame it takes to check the retry
  // budget. Deciding during render instead would be faster but wrong twice
  // over: reading sessionStorage isn't available server-side, so the first
  // client render would disagree with the server's and break hydration, and
  // spending the budget in a render React is free to discard would silently
  // eat a retry that never happened.
  const [phase, setPhase] = useState<"deciding" | "retrying" | "failed">("deciding")

  useEffect(() => {
    // Refreshing cannot fix a translation crash — the translator is still on,
    // so the next render dies the same way. Go straight to the screen that
    // tells her how to stop it.
    if (translationCrash || !reset || !retryAvailable()) {
      setPhase("failed")
      return
    }
    // The budget is spent here, not in render, and it is keyed to the tab
    // rather than to this component: reset() re-mounts us, so anything held
    // in state would come back fresh and retry forever.
    markRetryUsed()
    setPhase("retrying")
    // Long enough for a transient DOM race to settle, short enough to read as
    // a hiccup rather than a broken page.
    const t = setTimeout(reset, 600)
    return () => clearTimeout(t)
    // Mount only, on purpose. This decision belongs to the crash that mounted
    // us; re-running it because `reset` came back with a new identity would
    // cancel the pending retry AND spend a second budget on the way to
    // deciding it can't retry — the one combination that turns a recovery
    // into a dead end.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  // One frame, before the retry budget has been read.
  if (phase === "deciding") return null

  // The auto-retry is about to fire — show a recovering state, not a crash.
  // A student who never reads the word "שגיאה" is the whole point.
  if (phase === "retrying") {
    return (
      <div dir="rtl" className="min-h-screen bg-bg-surface flex items-center justify-center px-6 py-10">
        <div className="flex flex-col items-center gap-3 text-center">
          <div
            className="w-6 h-6 rounded-full border-2 border-border-neutral-default border-t-text-primary-default animate-spin"
            role="status"
            aria-label="טוען מחדש"
          />
          <p className="text-small text-text-neutral-default">רגע, טוענים מחדש…</p>
        </div>
      </div>
    )
  }

  return (
    <div dir="rtl" className="min-h-screen bg-bg-surface flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-md rounded-2xl border border-border-neutral-default bg-white dark:bg-gray-10 shadow-[0_8px_24px_rgba(0,0,0,0.06)] p-8 flex flex-col items-center text-center gap-5">
        <h1 className="text-display text-text-primary-default leading-tight">
          {translationCrash ? (
            <>
              התרגום של הדפדפן
              <br />
              שובר את העמוד
            </>
          ) : (
            <>
              אויש.. לעזאזל..
              <br />
              משהו בלתי צפוי קרה
            </>
          )}
        </h1>

        {/* Refreshing does nothing while the translator is still on — it just
            re-crashes on the next render. So a translation crash gets the one
            instruction that actually ends it. */}
        <p className="text-p text-text-primary-default">
          {translationCrash
            ? "הדפדפן מתרגם את העמוד לשפה אחרת, וזה מה שמפיל אותו. כבו את התרגום (לחצן התרגום בשורת הכתובת → ״הצג תמיד בעברית״) ורעננו."
            : "נסו לרענן את העמוד, ואם זה לא עוזר — שלחו לנו את ההודעה הזו."}
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
