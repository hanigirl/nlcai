"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { GeminiIcon } from "@/components/gemini-icon"
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
/**
 * Whether the connect notice should be on screen for this user.
 *
 * Exported so a page can both render the floating notice AND reserve room for
 * it in the same pass — on /project the notice is fixed, so without the page
 * knowing about it the flow cards end up underneath.
 */
export function useGeminiNoticeVisible(): boolean {
  // Starts false so nothing renders until we know — the notice must never
  // flash at users who already have a key.
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      // ?preview=gemini-notice forces the card on in its real page context.
      // Once a key is connected the banner is unreachable by design, which
      // otherwise makes it impossible to review in place without first
      // disconnecting a working key. Same idea as the ?variant= gates used
      // elsewhere for design review. Read inside the async body, not in the
      // effect body, so this isn't a synchronous setState during an effect.
      if (new URLSearchParams(window.location.search).get("preview") === "gemini-notice") {
        setVisible(true)
        return
      }
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
        // Stay hidden on a failed lookup — showing a setup banner to someone
        // who is already set up is worse than showing nothing.
        console.error("[gemini-notice]", error)
        return
      }
      const key = (data as { gemini_api_key?: string | null } | null)?.gemini_api_key
      setVisible(!key || key.trim().length === 0)
    }
    check()
    return () => { cancelled = true }
  }, [])

  return visible
}

export function GeminiConnectNotice({
  variant = "banner",
}: {
  variant?: "banner" | "floating"
}) {
  const visible = useGeminiNoticeVisible()
  if (!visible) return null

  return <GeminiConnectNoticeCard variant={variant} />
}

/**
 * The card itself, with no gating. Split out so it can be rendered directly
 * (e.g. /test/gemini-notice) to review the copy without holding an account
 * that is in the cohort and missing a key.
 */
const NOTICE_TITLE = "ההוקים עברו למנוע חדש — צריך לחבר מפתח Gemini"

function NoticeBody() {
  return (
    <>
      <p className="text-small text-text-primary-default">
        מהיום ההוקים נכתבים על ידי Gemini של גוגל. כדי לייצר הוקים צריך לחבר מפתח
        משלכם, פעם אחת. <span className="font-semibold">החיבור עצמו חינמי</span> —
        נכנסים ל-Google AI Studio, יוצרים מפתח, ומדביקים אותו בהגדרות.
      </p>

      <div className="flex justify-start pt-1">
        <Button asChild size="sm">
          <Link href="/settings?tab=connections&sub=gemini">לחיבור המפתח</Link>
        </Button>
      </div>
    </>
  )
}

/**
 * `banner`   — the standalone strip from the Figma, for full-width page tops.
 * `floating` — pinned message for the /project canvas. Fixed rather than
 *              placed in the flow: the canvas pans, and a notice that drifts
 *              off-screen with it stops being a notice. Sits below the sticky
 *              header and clear of the collapsed right sidebar.
 */
export function GeminiConnectNoticeCard({
  variant = "banner",
}: {
  variant?: "banner" | "floating"
}) {
  if (variant === "floating") {
    return (
      <div
        dir="rtl"
        // top: 3.5rem header + 1rem gap. right: 3rem collapsed sidebar + 1.5rem
        // gap, so it never sits under the rail. z-40 keeps it under the
        // header's z-50 rather than covering it.
        className="fixed top-[4.5rem] right-[4.5rem] z-40 w-[380px] rounded-[18px] border border-border-neutral-default bg-white dark:bg-gray-10 shadow-lg px-6 py-5 flex flex-col gap-3"
      >
        <div className="flex items-start gap-2">
          <GeminiIcon className="size-4 shrink-0 mt-0.5" id="project-notice" />
          <span className="text-p-bold text-text-primary-default">{NOTICE_TITLE}</span>
        </div>
        <NoticeBody />
      </div>
    )
  }

  return (
    <div
      dir="rtl"
      className="rounded-[18px] border border-border-neutral-default bg-bg-surface px-6 py-5 flex flex-col gap-3"
    >
      <div className="flex items-center gap-2">
        <GeminiIcon className="size-4 shrink-0" id="connect-notice" />
        <span className="text-p-bold text-text-primary-default">{NOTICE_TITLE}</span>
      </div>
      <NoticeBody />
    </div>
  )
}
