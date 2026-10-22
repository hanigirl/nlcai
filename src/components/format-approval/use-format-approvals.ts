"use client"

/**
 * useFormatApprovals — the "אישור מדיה" state for every format on one post.
 *
 * The rule the whole feature rests on: an approval belongs to the exact media
 * the user looked at when she approved it. Each format's media is reduced to a
 * signature (its asset URLs, in order). Approving stores that signature; if
 * the media later changes — a new slide, a re-burned caption, a replaced
 * image — the signature no longer matches and the approval is withdrawn on
 * the spot, with an "edited after approval" flag so the UI can say why.
 *
 *   no-media  → nothing to approve yet
 *   pending   → has media, waiting for "אישור"
 *   approved  → approved, and the media is still the one that was approved
 *   edited    → was approved, then the media changed → approval withdrawn
 *
 * `persist` writes approvals to timing-storage (the same store the calendar
 * reads for scheduled / published). The design-review harness runs with
 * `persist: false` so the preview never writes anything.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  approveFormat,
  getFormatMeta,
  getScheduledByPostId,
  revokeFormatApproval,
  type FormatId,
} from "@/lib/timing-storage"

/** "scheduled" = approved AND already on the calendar. */
export type ApprovalStatus = "no-media" | "pending" | "approved" | "scheduled" | "edited"

type Entry = { approvedAt: string; sig: string }

export type ApprovalSeed = {
  approved: FormatId[]
  edited: FormatId[]
  /** Approved formats that are also on the calendar. */
  scheduled?: FormatId[]
}

export type FormatApprovals = {
  statusOf: (format: FormatId) => ApprovalStatus
  approve: (format: FormatId) => void
  revoke: (format: FormatId) => void
  approvedCount: number
  /** Formats that have media and could be approved (pending/edited/approved). */
  approvableCount: number
  /** Review harness only — jump straight to a scenario. */
  seed: (seed: ApprovalSeed) => void
}

export function useFormatApprovals({
  postId,
  formats,
  mediaSigs,
  persist,
}: {
  postId: string | null
  formats: FormatId[]
  /** Per-format media signature — empty string when the format has no media. */
  mediaSigs: Record<string, string>
  persist: boolean
}): FormatApprovals {
  const [entries, setEntries] = useState<Record<string, Entry>>({})
  const [edited, setEdited] = useState<Record<string, boolean>>({})
  const [scheduled, setScheduled] = useState<Record<string, boolean>>({})

  const formatsKey = formats.join(",")
  const sigKey = formats.map((f) => `${f}=${mediaSigs[f] ?? ""}`).join("\n")

  // Hydrate saved approvals for a real post.
  useEffect(() => {
    if (!persist || !postId) return
    const next: Record<string, Entry> = {}
    for (const f of formatsKey.split(",").filter(Boolean)) {
      const meta = getFormatMeta(postId, f)
      if (meta.approvedAt) {
        next[f] = { approvedAt: meta.approvedAt, sig: meta.approvedMediaSig ?? "" }
      }
    }
    setEntries(next)
    const onCalendar: Record<string, boolean> = {}
    for (const row of getScheduledByPostId(postId)) onCalendar[row.format] = true
    setScheduled(onCalendar)
  }, [persist, postId, formatsKey])

  // Media changed after approval → the approval no longer describes what is
  // on screen. Withdraw it. An empty signature means "media not loaded yet /
  // removed" — that is handled by `no-media`, not by revoking, so a slow
  // hydration can't silently wipe a valid approval.
  useEffect(() => {
    const stale = Object.entries(entries).filter(([f, e]) => {
      const now = mediaSigs[f] ?? ""
      return now !== "" && now !== e.sig
    })
    if (stale.length === 0) return
    setEntries((prev) => {
      const next = { ...prev }
      for (const [f] of stale) delete next[f]
      return next
    })
    setEdited((prev) => {
      const next = { ...prev }
      for (const [f] of stale) next[f] = true
      return next
    })
    if (persist && postId) {
      for (const [f] of stale) revokeFormatApproval(postId, f)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sigKey, entries])

  const approve = useCallback(
    (format: FormatId) => {
      const sig = mediaSigs[format] ?? ""
      if (!sig) return
      setEntries((prev) => ({
        ...prev,
        [format]: { approvedAt: new Date().toISOString(), sig },
      }))
      setEdited((prev) => ({ ...prev, [format]: false }))
      if (persist && postId) approveFormat(postId, format, sig)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sigKey, persist, postId],
  )

  const revoke = useCallback(
    (format: FormatId) => {
      setEntries((prev) => {
        const next = { ...prev }
        delete next[format]
        return next
      })
      setEdited((prev) => ({ ...prev, [format]: false }))
      if (persist && postId) revokeFormatApproval(postId, format)
    },
    [persist, postId],
  )

  const statusOf = useCallback(
    (format: FormatId): ApprovalStatus => {
      const sig = mediaSigs[format] ?? ""
      if (!sig) return "no-media"
      if (entries[format]) return scheduled[format] ? "scheduled" : "approved"
      if (edited[format]) return "edited"
      return "pending"
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sigKey, entries, edited, scheduled],
  )

  const seed = useCallback(
    (s: ApprovalSeed) => {
      const nextEntries: Record<string, Entry> = {}
      for (const f of s.approved) {
        const sig = mediaSigs[f] ?? ""
        if (sig) nextEntries[f] = { approvedAt: new Date().toISOString(), sig }
      }
      const nextEdited: Record<string, boolean> = {}
      for (const f of s.edited) nextEdited[f] = true
      const nextScheduled: Record<string, boolean> = {}
      for (const f of s.scheduled ?? []) nextScheduled[f] = true
      setEntries(nextEntries)
      setEdited(nextEdited)
      setScheduled(nextScheduled)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sigKey],
  )

  const { approvedCount, approvableCount } = useMemo(() => {
    let approved = 0
    let approvable = 0
    for (const f of formats) {
      const s = statusOf(f)
      if (s === "approved" || s === "scheduled") approved++
      if (s !== "no-media") approvable++
    }
    return { approvedCount: approved, approvableCount: approvable }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formatsKey, statusOf])

  return { statusOf, approve, revoke, approvedCount, approvableCount, seed }
}
