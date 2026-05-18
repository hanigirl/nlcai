"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"

// Dev-only page for verifying the error boundary chain. Clicking the
// button throws during render, which bubbles to /app/error.tsx →
// /components/error-screen.tsx and auto-reports to /api/client-error.
// Safe to leave deployed: hitting the route does nothing until clicked,
// and the worst it can do is render the friendly fallback.
export default function CrashTest() {
  const [shouldCrash, setShouldCrash] = useState(false)
  if (shouldCrash) {
    throw new Error("Manual crash test from /dev/crash-test")
  }
  return (
    <div dir="rtl" className="min-h-screen bg-bg-surface flex items-center justify-center px-6">
      <div className="w-full max-w-md text-center flex flex-col gap-4">
        <h1 className="text-display text-text-primary-default">בדיקת מסך השגיאה</h1>
        <p className="text-p text-text-primary-default">
          לחיצה על הכפתור תזרוק שגיאה במכוון. אמור להופיע מסך &quot;אויש.. לעזאזל&quot;.
        </p>
        <Button
          onClick={() => setShouldCrash(true)}
          className="bg-button-primary-default hover:bg-button-primary-hover text-white"
        >
          תרסקי אותי
        </Button>
      </div>
    </div>
  )
}
