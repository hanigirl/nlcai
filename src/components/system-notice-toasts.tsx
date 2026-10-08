"use client"

import { useEffect } from "react"
import { toast } from "sonner"
import { NOTICE_COPY, isNoticeCode } from "@/lib/system-notice-copy"
import { dismissNotice, formatResetTime, noticeToastId } from "@/lib/gemini-quota-toasts"

/**
 * "Something ran out" notices (lib/system-notices) as bottom toasts, on
 * every page — mounted once in the root layout.
 *
 * They used to be a banner on the home page only, but the user is usually
 * somewhere else (the hooks warehouse, staring at hooks that came out worse)
 * when it matters (Hani, 2026-10-08). A notice stays until she closes it with
 * the X; closing dismisses it for good, server-side.
 *
 * Same toast id as the end-of-round quota toast (noticeToastId), so the two
 * never stack as duplicates.
 */

type Notice = { id: string; code: string; expires_at?: string | null }

export function SystemNoticeToasts() {
  useEffect(() => {
    let cancelled = false
    fetch("/api/notices")
      .then((r) => (r.ok ? r.json() : { notices: [] }))
      .then((d: { notices?: Notice[] }) => {
        if (cancelled) return
        for (const n of d.notices ?? []) {
          if (!isNoticeCode(n.code)) continue
          const copy = NOTICE_COPY[n.code]
          const { href, external } = copy.cta
          toast(copy.title, {
            id: noticeToastId(n.code),
            description: copy.body.replace("{reset}", formatResetTime(n.expires_at)),
            duration: Infinity,
            closeButton: true,
            action: {
              label: copy.cta.label,
              onClick: () => {
                if (external) window.open(href, "_blank", "noopener,noreferrer")
                else window.location.href = href
              },
            },
            onDismiss: () => dismissNotice({ id: n.id }),
          })
        }
      })
      .catch(() => {
        // Nothing shown on a failed lookup — never a broken toast.
      })
    return () => {
      cancelled = true
    }
  }, [])

  return null
}
