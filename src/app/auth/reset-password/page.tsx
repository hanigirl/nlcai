"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import logoNew from "../../../../images/logo-new.png"
import { createClient } from "@/lib/supabase/client"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

/**
 * "סיסמה חדשה" (2026-11-11). The password-reset email's link signs her in
 * (api: auth/callback) and lands here — before, it signed her in and never
 * asked for a new password, so the old one kept failing. Same look as /login.
 */
export default function ResetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 6) return setError("הסיסמא צריכה להכיל לפחות 6 תווים")
    if (password !== confirm) return setError("הסיסמאות לא זהות")
    setSaving(true)
    setError(null)
    const supabase = createClient()
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setSaving(false)
    if (updateError) {
      const msg = updateError.message.toLowerCase()
      setError(
        msg.includes("session") || msg.includes("auth")
          ? "הקישור פג תוקף. חזרו למסך הכניסה ולחצו שוב על 'שכחתי סיסמא'."
          : msg.includes("different") || msg.includes("same")
            ? "זו הסיסמא הקודמת. בחרו סיסמא חדשה."
            : "לא הצלחנו לשמור את הסיסמא. נסו שוב.",
      )
      return
    }
    router.replace("/")
  }

  return (
    <div dir="rtl" className="flex min-h-screen items-center justify-center px-6">
      <div className="flex w-full max-w-md flex-col items-center">
        <Image src={logoNew} alt="Next Level Content AI" className="mb-10 h-[86px] w-auto" priority />
        <Card className="w-full rounded-3xl border-border-neutral-default">
          <CardHeader className="items-center pb-2">
            <CardTitle className="text-center text-2xl text-text-primary-default">סיסמא חדשה</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={save} className="flex flex-col gap-4" noValidate>
              <Input
                type="password"
                placeholder="סיסמא חדשה *"
                autoComplete="new-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  setError(null)
                }}
                aria-invalid={!!error}
                autoFocus
              />
              <Input
                type="password"
                placeholder="אימות סיסמא *"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => {
                  setConfirm(e.target.value)
                  setError(null)
                }}
                aria-invalid={!!error}
              />
              {error && (
                <p role="alert" className="text-xs text-button-destructive-default">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={saving} className="h-12 w-full rounded-xl">
                {saving ? "שומרים..." : "שמירת הסיסמא"}
              </Button>
            </form>
            {/* Not now: back to the sign-in screen (signed in by the link → the app). */}
            <p className="mt-6 text-center text-small text-text-neutral-default">
              <Link href="/login" className="font-semibold text-text-primary-default hover:underline">
                חזרה למסך הכניסה
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
