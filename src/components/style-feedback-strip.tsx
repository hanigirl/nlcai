"use client"

import { useState } from "react"
import Link from "next/link"
import { Loader2, ThumbsDown, ThumbsUp } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { recordAiStyleVote } from "@/lib/ai-style-provenance"
import { DISLIKE_REASONS, type DislikeReason } from "@/lib/visual-language/types"

/**
 * 👍 / 👎 above AI media in every format but the avatar, in every style
 * (Hani, 2026-10-07). A style's brief is written once; this is what may
 * change it: a like locks it and makes this image its style reference, a
 * dislike rewrites it once with her reasons. See /api/visual-language/style-feedback.
 */
export function StyleFeedbackStrip({
  postId,
  format,
  style,
  mediaUrl,
  initialVote,
}: {
  postId: string
  format: string
  /** The style that made this media. */
  style: "brand" | "ai-dark" | "ai-light"
  /** The image she's looking at (used as the style anchor on 👍). */
  mediaUrl?: string | null
  initialVote?: "like" | "dislike"
}) {
  const [vote, setVote] = useState<"like" | "dislike" | null>(initialVote ?? null)
  const [askingWhy, setAskingWhy] = useState(false)
  const [reasons, setReasons] = useState<DislikeReason[]>([])
  const [note, setNote] = useState("")
  const [sending, setSending] = useState(false)
  const [adopting, setAdopting] = useState(false)
  const [adopted, setAdopted] = useState(false)

  const send = async (verdict: "like" | "dislike") => {
    setSending(true)
    try {
      const res = await fetch("/api/visual-language/style-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          style,
          format,
          verdict,
          postId,
          mediaUrl: mediaUrl?.startsWith("http") ? mediaUrl : undefined,
          ...(verdict === "dislike" ? { reasons, note } : {}),
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { message?: string }
      if (!res.ok) {
        toast.error(data.message ?? "הפידבק לא נשמר. נסו שוב.")
        return
      }
      setVote(verdict)
      setAskingWhy(false)
      recordAiStyleVote(postId, format, verdict)
      if (data.message) toast.success(data.message, { duration: 6000 })
    } catch (err) {
      console.error("[niche-feedback]", err)
      toast.error("הפידבק לא נשמר. נסו שוב.")
    } finally {
      setSending(false)
    }
  }

  const adopt = async () => {
    setAdopting(true)
    try {
      const res = await fetch("/api/visual-language/adopt-example", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId, format, mediaUrl: mediaUrl?.startsWith("http") ? mediaUrl : undefined }),
      })
      const data = (await res.json().catch(() => ({}))) as { message?: string }
      if (!res.ok) {
        toast.error(data.message ?? "ההוספה נכשלה")
        return
      }
      setAdopted(true)
    } finally {
      setAdopting(false)
    }
  }

  return (
    // Framed so it reads on the white carousel panel as well as the grey
    // preview band — borderless, it vanished on white.
    <div className="flex w-full flex-col items-center gap-2 rounded-xl border border-border-neutral-default bg-white px-4 py-3 dark:bg-gray-20">
      <div className="flex w-full items-center justify-between gap-3">
        <p className="text-xs text-text-neutral-default">הפידבק שלך ישפיע על יצירת מדיה עתידית</p>
        <div className="flex shrink-0 items-center gap-1" role="group" aria-label="פידבק על הסגנון">
          <VoteButton
            label="אהבתי את הסגנון"
            active={vote === "like"}
            disabled={sending}
            onClick={() => send("like")}
          >
            <ThumbsUp className="size-4" />
          </VoteButton>
          <VoteButton
            label="לא אהבתי את הסגנון"
            active={vote === "dislike" || askingWhy}
            disabled={sending}
            onClick={() => setAskingWhy((v) => !v)}
          >
            <ThumbsDown className="size-4" />
          </VoteButton>
        </div>
      </div>

      {askingWhy && (
        <div className="flex w-full flex-col gap-2">
          <p className="text-xs text-text-primary-default">מה לא עבד?</p>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(DISLIKE_REASONS) as DislikeReason[]).map((r) => {
              const on = reasons.includes(r)
              return (
                <button
                  key={r}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setReasons((prev) => (on ? prev.filter((x) => x !== r) : [...prev, r]))}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors cursor-pointer ${
                    on
                      ? "border-yellow-50 bg-bg-surface-primary-default text-text-primary-default"
                      : "border-border-neutral-default text-text-neutral-default hover:bg-gray-95 dark:hover:bg-gray-20"
                  }`}
                >
                  {DISLIKE_REASONS[r]}
                </button>
              )
            })}
          </div>
          <Textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="משהו נוסף? (לא חובה)"
            aria-label="פירוט נוסף על מה לא עבד"
            className="text-xs min-h-0"
          />
          <Button
            size="sm"
            onClick={() => send("dislike")}
            disabled={sending || (!reasons.length && !note.trim())}
            className="w-fit gap-1.5"
          >
            {sending && <Loader2 className="size-3.5 animate-spin" />}
            עדכון השפה
          </Button>
        </div>
      )}

      {/* Only a niche-language image can become her visual language — one
          made in her own language already is. */}
      {vote === "like" && !askingWhy && style !== "brand" && (
        adopted ? (
          <p className="w-full text-xs text-text-neutral-default">
            נוסף לדוגמאות שלך.{" "}
            <Link href="/settings?tab=media&sub=visual" className="underline">
              לניתוח השפה הוויזואלית
            </Link>
          </p>
        ) : (
          <button
            type="button"
            onClick={adopt}
            disabled={adopting}
            className="flex w-full items-center gap-1.5 text-start text-xs text-text-primary-default underline-offset-2 hover:underline cursor-pointer disabled:opacity-60"
          >
            {adopting && <Loader2 className="size-3.5 animate-spin" />}
            להפוך את זה לשפה הוויזואלית שלי
          </button>
        )
      )}
    </div>
  )
}

function VoteButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string
  active: boolean
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`flex size-8 items-center justify-center rounded-full transition-colors cursor-pointer disabled:opacity-50 ${
        active
          ? "bg-bg-surface-primary-default text-text-primary-default"
          : "text-text-neutral-default hover:bg-gray-95 dark:hover:bg-gray-30"
      }`}
    >
      {children}
    </button>
  )
}
