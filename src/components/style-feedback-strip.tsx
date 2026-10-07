"use client"

import { useState } from "react"
import { ThumbsDown, ThumbsUp } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { getAiStyle, recordAiStyleVote } from "@/lib/ai-style-provenance"
import { getFormatMeta } from "@/lib/timing-storage"
import { BRAND_TEMPLATE_ID } from "@/lib/carousel-templates"
import { DISLIKE_REASONS, type DislikeReason } from "@/lib/visual-language/types"

type FeedbackStyle = "brand" | "ai-dark" | "ai-light"

/**
 * 👍 / 👎 row inside a format's result card on the canvas — "אהבת את מה
 * שיצרנו?" under the card header (Figma 651:1599). Every AI format but the
 * avatar, every style. A style's brief is written once; this is what may
 * change it: a like locks it and makes this image its style reference, a
 * dislike rewrites it once with her reasons.
 * See /api/visual-language/style-feedback.
 *
 * Renders nothing unless the card's media was made by AI in a known style:
 * the store records that per post + format (carousels by their template).
 */
export function CardStyleFeedback({
  postId,
  format,
  mediaUrl,
}: {
  postId: string | null | undefined
  format: "carousel" | "story" | "image_post" | "b_roll"
  /** The media the card shows — must be the one the AI made. */
  mediaUrl?: string | null
}) {
  if (!postId || typeof window === "undefined") return null

  let style: FeedbackStyle | null = null
  let vote: "like" | "dislike" | undefined
  if (format === "carousel") {
    const tid = getFormatMeta(postId, "carousel").templateId
    style = tid === BRAND_TEMPLATE_ID ? "brand" : tid === "ai-dark" || tid === "ai-light" ? tid : null
    vote = getAiStyle(postId, "carousel")?.vote
  } else {
    const rec = getAiStyle(postId, format)
    // Story sets have no stable URL until reload — tracked per format only.
    if (rec && rec.style !== "niche" && (format === "story" || rec.mediaKey === mediaUrl)) {
      style = rec.style
      vote = rec.vote
    }
  }
  if (!style) return null

  return (
    <StyleFeedbackRow
      key={`${format}:${mediaUrl ?? ""}`}
      postId={postId}
      format={format}
      style={style}
      mediaUrl={mediaUrl}
      initialVote={vote}
    />
  )
}

function StyleFeedbackRow({
  postId,
  format,
  style,
  mediaUrl,
  initialVote,
}: {
  postId: string
  format: string
  style: FeedbackStyle
  mediaUrl?: string | null
  initialVote?: "like" | "dislike"
}) {
  const [vote, setVote] = useState<"like" | "dislike" | null>(initialVote ?? null)
  const [askingWhy, setAskingWhy] = useState(false)
  const [reasons, setReasons] = useState<DislikeReason[]>([])
  const [note, setNote] = useState("")

  const httpUrl = mediaUrl?.startsWith("http") ? mediaUrl : undefined

  /**
   * Thumbs are toggles that switch freely (Hani, 2026-10-07), like YouTube:
   * tap 👍 → liked, tap again → off; tap 👎 while liked → 👍 off, 👎 on at
   * once. 👎 opens optional reasons — only submitting them rewrites the
   * language. Optimistic: the thumb answers on tap, the save runs behind it,
   * a failure rolls back with an error.
   */
  const post = async (
    verdict: "like" | "dislike" | "clear",
    withReasons = false,
  ): Promise<{ ok: boolean; message?: string }> => {
    try {
      const res = await fetch("/api/visual-language/style-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          style,
          format,
          verdict,
          postId,
          mediaUrl: httpUrl,
          ...(withReasons ? { reasons, note } : {}),
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { message?: string }
      return { ok: res.ok, message: data.message }
    } catch (err) {
      console.error("[style-feedback]", err)
      return { ok: false }
    }
  }

  const setVoteEverywhere = (next: "like" | "dislike" | null) => {
    setVote(next)
    recordAiStyleVote(postId, format, next)
  }

  const toggle = async (thumb: "like" | "dislike") => {
    const prev = vote
    const next = vote === thumb ? null : thumb
    setVoteEverywhere(next)
    setAskingWhy(next === "dislike")
    const res = await post(next ?? "clear")
    if (!res.ok) {
      setVoteEverywhere(prev)
      setAskingWhy(false)
      toast.error(res.message ?? "הפידבק לא נשמר. נסו שוב.")
    } else if (next === "like" && res.message) {
      toast.success(res.message, { duration: 5000 })
    }
  }

  // Submitting the reasons is what rewrites the language (one Claude call).
  const sendReasons = async () => {
    setAskingWhy(false)
    const toastId = toast.loading("מעדכנים את השפה לפי הפידבק...")
    const res = await post("dislike", true)
    if (!res.ok) toast.error(res.message ?? "לא הצלחנו לעדכן את השפה. נסו שוב.", { id: toastId })
    else toast.success(res.message ?? "השפה עודכנה.", { id: toastId, duration: 6000 })
    setReasons([])
    setNote("")
  }

  return (
    <div className="flex w-full flex-col gap-3" onMouseDown={(e) => e.stopPropagation()}>
      {/* The whole row is the tooltip trigger, so hovering anywhere on it —
          the text or either button — explains what the vote does. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex w-full items-center justify-between px-5">
            <p className="text-xs text-gray-40">אהבת את מה שיצרנו?</p>
            <div className="flex items-center gap-1" role="group" aria-label="פידבק על הסגנון">
              <VoteButton label="אהבתי" active={vote === "like"} tilt="-14deg" onClick={() => toggle("like")}>
                {(filled) => <ThumbsUp className="size-4" fill={filled ? "currentColor" : "none"} />}
              </VoteButton>
              <VoteButton label="לא אהבתי" active={vote === "dislike"} tilt="14deg" onClick={() => toggle("dislike")}>
                {(filled) => <ThumbsDown className="size-4" fill={filled ? "currentColor" : "none"} />}
              </VoteButton>
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top">הפידבק שלך ישפיע על הגירסאות הבאות</TooltipContent>
      </Tooltip>

      {askingWhy && (
        <div className="flex flex-col gap-2 px-5">
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
            onClick={sendReasons}
            disabled={!reasons.length && !note.trim()}
            className="w-fit gap-1.5"
          >
            עדכון השפה
          </Button>
        </div>
      )}

      <div className="h-px w-full bg-border-neutral-default" role="separator" />
    </div>
  )
}

/**
 * A thumb that pops when tapped and, when active, is filled in the primary
 * colour — no background state (Hani, 2026-10-07). The icon remounts on
 * each tap so the bump replays every time.
 */
function VoteButton({
  label,
  active,
  tilt,
  onClick,
  children,
}: {
  label: string
  active: boolean
  /** Which way the pop leans — toward the thumb's direction. */
  tilt: string
  onClick: () => void
  children: (filled: boolean) => React.ReactNode
}) {
  const [taps, setTaps] = useState(0)
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={() => {
        setTaps((n) => n + 1)
        onClick()
      }}
      className={`flex size-8 items-center justify-center rounded-full ${
        active ? "text-button-primary-default" : "text-text-primary-default"
      } cursor-pointer hover:bg-gray-95 dark:hover:bg-gray-30`}
    >
      <span
        key={taps}
        className={`flex ${taps > 0 ? "vote-bump" : ""}`}
        style={{ "--vote-tilt": tilt } as React.CSSProperties}
      >
        {children(active)}
      </span>
    </button>
  )
}
