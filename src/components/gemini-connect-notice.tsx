"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { usesGeminiHooks } from "@/lib/owner"

/**
 * In-page notice (deliberately not a toast) telling the user that hook
 * generation moved to Gemini and needs a key of their own.
 *
 * A toast was the wrong shape here: it disappears, and this is a blocking
 * setup step the user has to act on — she may well land on the page, read
 * it, go fetch a key, and come back. It has to still be there when she does.
 *
 * Renders nothing once a key is connected, so it costs connected users
 * nothing and disappears by itself the moment the problem is solved.
 */
export function GeminiConnectNotice() {
  // null = still checking. Nothing renders until we know, so the banner never
  // flashes at users who already have a key.
  const [connected, setConnected] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      // Students outside the pilot still generate hooks with Claude and were
      // never asked for a Gemini key — telling them to go get one would be
      // instructions for a change that hasn't reached them.
      if (!usesGeminiHooks(user.email)) return
      const { data, error } = await supabase
        .from("users")
        .select("gemini_api_key")
        .eq("id", user.id)
        .maybeSingle()
      if (cancelled) return
      if (error) {
        // Treat a failed lookup as "connected" — showing a setup banner to
        // someone who is already set up is worse than showing nothing.
        console.error("[gemini-notice]", error)
        setConnected(true)
        return
      }
      const key = (data as { gemini_api_key?: string | null } | null)?.gemini_api_key
      setConnected(!!key && key.trim().length > 0)
    }
    check()
    return () => { cancelled = true }
  }, [])

  if (connected !== false) return null

  return (
    <div
      dir="rtl"
      className="rounded-2xl border border-border-neutral-default bg-bg-surface-primary-default px-6 py-5 flex flex-col gap-3"
    >
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-text-primary-default shrink-0" />
        <span className="text-p-bold text-text-primary-default">
          ההוקים עברו למנוע חדש — צריך לחבר מפתח Gemini
        </span>
      </div>

      <p className="text-small text-text-primary-default">
        מהיום ההוקים נכתבים על ידי Gemini של גוגל. כדי לייצר הוקים צריך לחבר מפתח
        משלכם, פעם אחת. <span className="font-semibold">החיבור עצמו חינמי</span> —
        נכנסים ל-Google AI Studio, יוצרים מפתח, ומדביקים אותו בהגדרות.
      </p>

      <p className="text-small text-text-neutral-default">
        <span className="font-semibold text-text-primary-default">רוצים את האיכות הגבוהה ביותר?</span>{" "}
        מפתח חינמי עובד, אבל הוא מריץ את המודל הקל של Gemini וההוקים יוצאים פחות
        חדים. המודל החזק דורש שיהיה <span className="font-semibold">חיוב פעיל (Cloud Billing)
        על הפרויקט</span> שממנו יצרתם את המפתח — או דרך הארגון שלכם, אם אתם על
        חשבון עסקי, או בטעינת קרדיט ב-AI Studio (מינימום 10$, ומספיק להמון הוקים).
      </p>

      <p className="text-small text-text-neutral-default">
        ⚠️ <span className="font-semibold text-text-primary-default">מנוי לא מספיק.</span>{" "}
        מנוי Gemini Advanced או Google Workspace פותח את המודלים החזקים רק בתוך
        האתר של Google AI Studio — לא דרך מפתח API כמו שאנחנו משתמשים. אל תשלמו על
        מנוי בשביל זה.
      </p>

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <Button asChild size="sm" className="gap-1.5">
          <Link href="/settings?tab=connections&sub=gemini">לחיבור המפתח</Link>
        </Button>
        <a
          href="https://aistudio.google.com/apikey"
          target="_blank"
          rel="noopener noreferrer"
          className="text-small-bold text-text-primary-default hover:underline"
        >
          ליצירת מפתח ב-Google AI Studio →
        </a>
      </div>
    </div>
  )
}
