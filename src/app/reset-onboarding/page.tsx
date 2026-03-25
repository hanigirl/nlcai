"use client"

import { useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"

export default function ResetOnboardingPage() {
  const [status, setStatus] = useState("")

  async function handleReset() {
    setStatus("מאפס...")
    const supabase = createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setStatus("את לא מחוברת. התחברי קודם ב /login")
      return
    }

    const { error } = await supabase.auth.updateUser({
      data: { onboarding_completed: false },
    })

    if (error) {
      setStatus(`שגיאה: ${error.message}`)
      return
    }

    await supabase.auth.refreshSession()
    setStatus("הצלחה! מעביר לאונבורדינג...")
    window.location.href = "/onboarding"
  }

  return (
    <div dir="rtl" className="flex min-h-screen flex-col items-center justify-center gap-4">
      <Button onClick={handleReset} className="h-12 rounded-xl px-8">
        אפס אונבורדינג
      </Button>
      {status && (
        <p className="text-p text-text-neutral-default">{status}</p>
      )}
    </div>
  )
}
