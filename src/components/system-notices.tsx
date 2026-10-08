"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { AlertTriangle, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { NOTICE_COPY, isNoticeCode } from "@/lib/system-notice-copy"

/**
 * Home-page banners for "something ran out" — the user's own limits (Claude
 * credits, Gemini's daily cap, a dead Gemini key). Raised server-side where the failure happens
 * (lib/system-notices.ts), so it is still here when she comes back, unlike a
 * toast. Same card language as the Gemini connect notice. Admin-only notices
 * (app accounts) are supported by the API; none are raised today.
 *
 * Renders nothing when there's nothing to say.
 */

type Notice = { id: string; audience: "user" | "admin"; code: string }

export function SystemNotices() {
  const [notices, setNotices] = useState<Notice[]>([])

  useEffect(() => {
    let cancelled = false
    fetch("/api/notices")
      .then((r) => (r.ok ? r.json() : { notices: [] }))
      .then((d: { notices?: Notice[] }) => {
        if (!cancelled) setNotices((d.notices ?? []).filter((n) => isNoticeCode(n.code)))
      })
      .catch(() => {
        // A failed lookup shows nothing — never a broken banner.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const dismiss = (id: string) => {
    setNotices((prev) => prev.filter((n) => n.id !== id))
    void fetch("/api/notices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {})
  }

  if (notices.length === 0) return null

  return (
    <div className="flex flex-col gap-3">
      {notices.map((n) => {
        if (!isNoticeCode(n.code)) return null
        const copy = NOTICE_COPY[n.code]
        return (
          <div
            key={n.id}
            dir="rtl"
            role="status"
            className="rounded-[18px] border border-border-neutral-default bg-bg-surface px-6 py-5 flex flex-col gap-3"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 shrink-0 text-text-neutral-default" aria-hidden />
              <span className="min-w-0 flex-1 text-p-bold text-text-primary-default">{copy.title}</span>
              {n.audience === "admin" && (
                <span className="shrink-0 rounded-full bg-white dark:bg-gray-10 px-2 py-0.5 text-xs text-text-neutral-default">
                  למנהלות בלבד
                </span>
              )}
              <button
                type="button"
                onClick={() => dismiss(n.id)}
                aria-label="סגירה"
                className="-me-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-text-neutral-default transition-colors hover:bg-bg-surface-hover hover:text-text-primary-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
              >
                <X className="size-4" />
              </button>
            </div>
            <p className="text-small text-text-primary-default">{copy.body}</p>
            <div className="flex justify-start pt-1">
              <Button asChild size="sm">
                {copy.cta.external ? (
                  <a href={copy.cta.href} target="_blank" rel="noopener noreferrer">
                    {copy.cta.label}
                  </a>
                ) : (
                  <Link href={copy.cta.href}>{copy.cta.label}</Link>
                )}
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
