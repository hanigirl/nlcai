"use client"

import { useState } from "react"
import { AlertCircle, CheckCircle2, ExternalLink, Loader2, Send, Clock } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import type { InstagramConnection } from "@/lib/instagram-connection"
import { actionFor, type PublishAction, type PublishState } from "@/lib/social/publish-state"
import { formatSlotForHumans, slotToInstant } from "@/lib/social/slot-time"
import { markPublished, retryPublish, type ScheduledPost } from "@/lib/timing-storage"

/**
 * One line on a scheduled card: is this going to Instagram, and if not, why.
 *
 * The rule (Hani, 2026-10-15): "תוזמן" only when the provider holds the post
 * with an id. Everything else says what it is — "בתהליך" while the call is in
 * flight, red with the reason and ONE action when it failed. Never a quiet
 * in-between that reads as scheduled.
 *
 * Reads `post.publish` (server-computed) and the shared connection state.
 * Kept presentational apart from its action button, so the canvas card and
 * the calendar format preview can drop it in as-is.
 */

type View = {
  tone: "neutral" | "success" | "danger" | "pending"
  label: string
  detail?: string | null
  action?: PublishAction | null
}

function viewFor(
  post: ScheduledPost,
  connection: InstagramConnection,
): View | null {
  const state: PublishState | undefined = post.publish

  // Published wins over everything: by hand, or reported by the provider.
  if (post.publishedAt || state?.status === "published") {
    return { tone: "success", label: "פורסם" }
  }

  // Nothing to say until we know whether there's a connection at all.
  if (connection.status === "loading") return null

  // A slot in the past that was never sent is history, not a warning.
  if (!state || state.status === "idle") {
    try {
      if (slotToInstant(post.scheduledDate, post.scheduledTime ?? "09:00").getTime() < Date.now()) {
        return null
      }
    } catch {
      return null
    }
  }

  if (connection.status !== "connected") {
    return {
      tone: "danger",
      label: "לא יפורסם — אינסטגרם לא מחובר",
      action: connection.primary?.status === "needs_reconnect" ? "reconnect" : "connect",
    }
  }

  if (!state || state.status === "pending") {
    return { tone: "pending", label: "בתהליך" }
  }

  const when = state.publishAt ? formatSlotForHumans(new Date(state.publishAt)) : null

  switch (state.status) {
    case "queued":
      if (state.code === "content_changed") {
        return {
          tone: "danger",
          label: "השתנה מאז התזמון — לעדכן?",
          detail: state.message,
          action: "update",
        }
      }
      return { tone: "success", label: when ? `תוזמן לאינסטגרם · ${when}` : "תוזמן לאינסטגרם" }
    case "sent":
      return {
        tone: "neutral",
        label: when ? `יצא לפרסום ב-${when}` : "יצא לפרסום",
        detail: "אינסטגרם עוד לא אישרה שהפוסט עלה.",
        action: "mark_published",
      }
    case "idle":
      // A slot from before the bridge existed: on the board, never sent.
      return { tone: "neutral", label: "על הלוח בלבד — לא נשלח לאינסטגרם", action: "retry" }
    case "failed":
    default:
      return {
        tone: "danger",
        label: "לא תוזמן",
        detail: state.message,
        action: actionFor(state),
      }
  }
}

const ACTION_LABEL: Record<PublishAction, string> = {
  connect: "חיבור אינסטגרם",
  reconnect: "לחבר מחדש",
  retry: "לנסות שוב",
  fix_media: "לתקן מדיה",
  pick_time: "לבחור מועד",
  update: "לעדכן",
  mark_published: "סימון כפורסם",
}

export function PublishStatusLine({
  post,
  connection,
  onConnect,
  onPickTime,
  onFixMedia,
  className,
}: {
  post: ScheduledPost
  connection: InstagramConnection
  /** Opens the shared Instagram connection modal. */
  onConnect: () => void
  /** Opens the card's date picker. */
  onPickTime: () => void
  /** Takes her to where the media is edited. */
  onFixMedia: () => void
  className?: string
}) {
  const [working, setWorking] = useState(false)
  const view = viewFor(post, connection)
  if (!view) return null

  // The idle "send it" action reads as retry in code, but on a board-only
  // slot it is the first send, so it says so.
  const actionLabel =
    view.action === "retry" && post.publish?.status === "idle"
      ? "לשלוח לתזמון"
      : view.action
        ? ACTION_LABEL[view.action]
        : null

  async function run(e: React.MouseEvent) {
    // The card underneath is a drag handle and a click target.
    e.stopPropagation()
    switch (view?.action) {
      case "connect":
      case "reconnect":
        onConnect()
        return
      case "pick_time":
        onPickTime()
        return
      case "fix_media":
        onFixMedia()
        return
      case "mark_published":
        markPublished(post.corePostId, post.format)
        return
      case "retry":
      case "update": {
        setWorking(true)
        try {
          const next = await retryPublish(
            post.corePostId,
            post.format,
            view.action === "update" ? "update" : "retry",
          )
          if (next?.status === "queued") toast.success("הפוסט תוזמן לאינסטגרם")
          else if (next?.status === "failed" && next.message) toast.error(next.message)
        } finally {
          setWorking(false)
        }
        return
      }
    }
  }

  const Icon =
    view.tone === "success"
      ? CheckCircle2
      : view.tone === "danger"
        ? AlertCircle
        : view.tone === "pending"
          ? Loader2
          : post.publish?.status === "sent"
            ? Send
            : Clock

  return (
    <div
      className={cn("flex min-w-0 flex-col gap-0.5 text-[11px] leading-tight", className)}
      // Screen readers hear a change in status without hunting for it.
      aria-live="polite"
    >
      <div
        className={cn(
          "flex min-w-0 items-start gap-1",
          view.tone === "success" && "text-green-20 dark:text-green-80",
          view.tone === "danger" && "text-button-destructive-default",
          (view.tone === "neutral" || view.tone === "pending") && "text-text-neutral-default",
        )}
      >
        <Icon
          aria-hidden
          className={cn("mt-px size-3 shrink-0", view.tone === "pending" && "animate-spin")}
        />
        <span className="min-w-0">{view.label}</span>
        {view.tone === "success" && post.publish?.permalink && (
          <a
            href={post.publish.permalink}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            aria-label="צפייה בפוסט באינסטגרם"
            className="ms-auto inline-flex shrink-0 items-center hover:text-text-primary-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 rounded"
          >
            <ExternalLink className="size-3" />
          </a>
        )}
      </div>

      {view.detail && <p className="text-text-neutral-default line-clamp-3">{view.detail}</p>}

      {actionLabel && (
        <button
          type="button"
          onClick={run}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          disabled={working}
          className="w-fit rounded font-medium text-text-primary-default underline underline-offset-2 hover:no-underline disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
        >
          {working ? "שולחים…" : actionLabel}
        </button>
      )}
    </div>
  )
}
