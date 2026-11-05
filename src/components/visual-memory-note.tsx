"use client"

import { useState } from "react"
import Link from "next/link"
import { AlertTriangle, Check, Info, Loader2, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  FORMAT_IN,
  RULE_SCOPES,
  SETTINGS_TOPIC_LABEL,
  VISUAL_PREFERENCES_HREF,
  VISUAL_SETTINGS_HREF,
  applyAcrossTheBoard,
  deletePreference,
  memoryHeadline,
  type MemoryOutcome,
} from "@/lib/visual-memory"

/**
 * What the AI-edit chat says about memory under one reply (rules:
 * lib/visual-memory): saved ("שמרתי את הנתונים."), belongs in the settings
 * (with the link), or contradicts an earlier preference (across the board,
 * or just this edit?). Green only for "saved", like the copy chat's saved
 * line; everything else stays neutral — no yellow (Hani: "די עם הצהוב הזה").
 */

const LINK =
  "font-semibold underline underline-offset-2 hover:text-text-primary-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-70 rounded-sm"

const scopeLabel = (scope: string) => RULE_SCOPES.find((s) => s.id === scope)?.label ?? scope

/** Presentational — every state, for the panel and for /test/save-to-visual-language. */
export function VisualMemoryNoteView({
  memory,
  showHeadline = true,
  busy = null,
  onUndo,
  onAcross,
  onThisEdit,
  className = "",
}: {
  memory: MemoryOutcome
  /** False when the reply bubble above already says the headline. */
  showHeadline?: boolean
  busy?: "undo" | "across" | null
  onUndo?: () => void
  onAcross?: () => void
  onThisEdit?: () => void
  className?: string
}) {
  const headline = memoryHeadline(memory)

  if (memory.kind === "saved") {
    return (
      <div
        role="status"
        className={`flex items-start gap-2 rounded-xl border border-green-success-50 bg-green-success-97 px-3 py-2 dark:bg-green-success-50/15 ${className}`}
      >
        <Check className="mt-0.5 size-4 shrink-0 text-green-success-50 dark:text-green-80" aria-hidden />
        <div className="flex-1 text-xs-body leading-relaxed text-green-success-50 dark:text-green-80">
          <p>
            {showHeadline && <span className="font-semibold">{headline} </span>}
            {memory.summary}
            <span className="text-text-neutral-default"> · {scopeLabel(memory.scope)}</span>
          </p>
          <Link href={VISUAL_PREFERENCES_HREF} className={LINK}>
            לכל ההעדפות הוויזואליות
          </Link>
        </div>
        <button
          type="button"
          onClick={onUndo}
          disabled={busy === "undo"}
          aria-label="ביטול השמירה"
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs-body text-text-neutral-default hover:bg-gray-95 hover:text-text-primary-default dark:hover:bg-gray-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-70 disabled:opacity-60"
        >
          {busy === "undo" ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <RotateCcw className="size-3" aria-hidden />}
          ביטול
        </button>
      </div>
    )
  }

  if (memory.kind === "settings") {
    const topics = memory.topics.map((t) => SETTINGS_TOPIC_LABEL[t]).join(", ")
    return (
      <div
        role="status"
        className={`flex items-start gap-2 rounded-xl border border-border-neutral-default bg-bg-surface px-3 py-2 ${className}`}
      >
        <Info className="mt-0.5 size-4 shrink-0 text-text-neutral-default" aria-hidden />
        <div className="flex-1 space-y-1 text-xs-body leading-relaxed text-text-primary-default">
          {showHeadline && <p className="font-semibold">{headline}</p>}
          <p className="text-text-neutral-default">
            ביקשתם: {memory.summary.replace(/[.\s]+$/, "")}.{" "}
            {memory.locked && memory.format
              ? `${FORMAT_IN[memory.format]} הפונט נלקח תמיד מההגדרות, ולכן הוא לא משתנה בעריכה.`
              : memory.lasting
                ? `${topics} נקבעים בהגדרות, ולכן לא שמרתי את זה מהצ׳אט.`
                : "זה חל רק על העריכה הזו. כדי שזה יחול גם בפעמים הבאות, יש לשנות את זה בהגדרות."}
          </p>
          <Link href={VISUAL_SETTINGS_HREF} className={LINK}>
            להגדרות השפה הוויזואלית
          </Link>
        </div>
      </div>
    )
  }

  if (memory.kind === "conflict") {
    return (
      <div
        role="group"
        aria-label="סתירה להעדפה קודמת"
        className={`flex items-start gap-2 rounded-xl border border-border-neutral-default bg-bg-surface px-3 py-2 ${className}`}
      >
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-text-primary-default" aria-hidden />
        <div className="flex-1 space-y-1.5 text-xs-body leading-relaxed text-text-primary-default">
          {showHeadline && <p className="font-semibold">{headline}</p>}
          <ul className="space-y-0.5 text-text-neutral-default">
            {memory.previous.map((p) => (
              <li key={p.id}>קודם: ״{p.summary}״</li>
            ))}
            <li>עכשיו: ״{memory.proposal.summary_he}״</li>
          </ul>
          <p>לשנות באופן רוחבי, לכל הפעמים הבאות, או רק בעריכה הזו?</p>
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            <Button size="xs" onClick={onAcross} disabled={!!busy} aria-busy={busy === "across"}>
              {busy === "across" && <Loader2 className="animate-spin" aria-hidden />}
              באופן רוחבי
            </Button>
            <Button size="xs" variant="outline" onClick={onThisEdit} disabled={!!busy}>
              רק בעריכה הזו
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (!headline || !showHeadline) return null
  const Icon = memory.kind === "error" ? AlertTriangle : Check
  return (
    <p
      role={memory.kind === "error" ? "alert" : "status"}
      className={`inline-flex items-start gap-1.5 text-xs-body leading-relaxed text-text-neutral-default ${className}`}
    >
      <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      {headline}
    </p>
  )
}

/** The live note: undo, and the answer to a contradiction, change `memory` through onChange. */
export function VisualMemoryNote({
  memory,
  showHeadline,
  onChange,
  className,
}: {
  memory: MemoryOutcome
  showHeadline?: boolean
  onChange: (next: MemoryOutcome) => void
  className?: string
}) {
  const [busy, setBusy] = useState<"undo" | "across" | null>(null)

  const undo = async () => {
    if (memory.kind !== "saved") return
    setBusy("undo")
    try {
      await deletePreference(memory.id)
      onChange({ kind: "undone", summary: memory.summary })
    } catch (err) {
      console.error("[visual-memory] undo failed", err)
      toast.error("לא הצלחנו לבטל את השמירה. נסו שוב.")
    } finally {
      setBusy(null)
    }
  }

  const across = async () => {
    if (memory.kind !== "conflict") return
    setBusy("across")
    try {
      const saved = await applyAcrossTheBoard(memory.previous, memory.proposal)
      onChange({ kind: "saved", id: saved.id, summary: saved.summary, scope: saved.scope, replaced: true })
    } catch (err) {
      console.error("[visual-memory] replace failed", err)
      toast.error(err instanceof Error ? err.message : "לא הצלחנו לעדכן את ההעדפה. נסו שוב.")
    } finally {
      setBusy(null)
    }
  }

  const thisEdit = () => {
    if (memory.kind !== "conflict") return
    onChange({ kind: "kept", previous: memory.previous.map((p) => p.summary) })
  }

  return (
    <VisualMemoryNoteView
      memory={memory}
      showHeadline={showHeadline}
      busy={busy}
      onUndo={() => void undo()}
      onAcross={() => void across()}
      onThisEdit={thisEdit}
      className={className}
    />
  )
}
