"use client"

import { useEffect, useRef, useState } from "react"
import { X } from "lucide-react"
import { AiSparkle } from "@/components/ai-refine-button"
import { useDismissOnOutsideClick } from "@/lib/use-dismiss-on-outside-click"
import { COPY_NOUN } from "@/lib/format-copy-refine"
import { REFERENCE_ONLY_INSTRUCTION } from "@/lib/ai-edit-references"
import {
  ReferenceButton,
  ReferenceDropHint,
  ReferenceThumbs,
  ReferenceTray,
  useReferenceImages,
} from "@/components/ai-edit-reference"
import type { FormatCopyAiController } from "./use-format-copy-ai"
import {
  CopyAppliedNote,
  CopyComposer,
  CopyErrorLine,
  CopyLoadingLine,
  CopyProposalActions,
  CopySuggestionChips,
} from "./copy-ai-parts"

/**
 * "עריכה עם AI" for one format's copy — the same panel as the core post.
 *
 * The ✨ button on a format card opens the same docked chat the core post
 * uses (bottom-right, fixed, outside the canvas transform), scoped to that
 * one format. The revision lands in the card; keep/undo live in the thread.
 * One mental model across the whole page: every ✨ opens the same panel.
 */
export function FormatCopyChat({
  ctrl,
  floating = true,
}: {
  ctrl: FormatCopyAiController
  /** false = render in flow (the /test state page); the app always floats it. */
  floating?: boolean
}) {
  const fid = ctrl.activeFid
  const [input, setInput] = useState("")
  const scrollRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  // Only the floating panel closes on an outside click; the /test page renders it in flow.
  useDismissOnOutsideClick(panelRef, floating && !!fid, ctrl.close)
  const session = fid ? ctrl.session(fid) : null
  // Screenshots waiting to go with the next message; a different format starts clean.
  const refs = useReferenceImages()
  const { clear: clearRefs } = refs
  useEffect(() => {
    clearRefs()
  }, [fid, clearRefs])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [session?.messages.length, session?.loading, session?.error])

  if (!fid || !session) return null

  const send = (text: string) => {
    const attached = refs.refs
    if (!text.trim() && !attached.length) return
    ctrl.send(fid, text.trim() || REFERENCE_ONLY_INSTRUCTION, attached)
    setInput("")
    refs.clear()
  }
  const fresh = session.messages.length === 0

  return (
    <div
      ref={panelRef}
      data-demo="copy-ai-panel"
      dir="rtl"
      role="dialog"
      aria-label={`עריכת ${COPY_NOUN[fid]} עם AI`}
      {...refs.dropProps}
      className={`${floating ? "fixed bottom-6 right-6 z-50 max-h-[72vh]" : "relative max-h-[560px]"} flex w-[380px] flex-col overflow-hidden rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 shadow-xl`}
    >
      <ReferenceDropHint show={refs.dragging} />
      <div className="flex items-center gap-2 border-b border-border-neutral-default bg-bg-surface px-4 py-3">
        <AiSparkle />
        <span className="text-small-bold text-text-primary-default">עריכת {COPY_NOUN[fid]}</span>
        <button
          type="button"
          onClick={ctrl.close}
          aria-label="סגירה"
          className="ms-auto inline-flex size-7 items-center justify-center rounded-md text-text-neutral-default hover:bg-gray-95 dark:hover:bg-gray-20 hover:text-text-primary-default transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
        >
          <X className="size-4" />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        <div className="flex flex-col items-end gap-2">
          <div className="max-w-[85%] rounded-2xl rounded-se-sm bg-bg-surface px-3 py-2 text-small leading-relaxed text-text-primary-default">
            מה לשנות ב{COPY_NOUN[fid]}? כתבו לי, או בחרו אחת מההצעות.
          </div>
          {fresh && (
            <CopySuggestionChips fid={fid} disabled={session.loading} onPick={send} className="justify-end max-w-[85%]" />
          )}
        </div>

        {session.messages.map((m, i) => (
          <div key={i} className={`flex flex-col gap-1.5 ${m.role === "user" ? "items-start" : "items-end"}`}>
            {/* A revision just lands in the card — no sentence about what changed
                (Hani, 2026-10-29: "סתם מבלבל"). A reply without one (a question) shows. */}
            {!(m.role === "assistant" && m.revised) && (
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-small leading-relaxed text-text-primary-default ${
                  m.role === "user" ? "bg-bg-surface-primary-default rounded-ss-sm" : "bg-bg-surface rounded-se-sm"
                }`}
              >
                {m.content}
                <ReferenceThumbs images={m.images} className="mt-1.5" />
              </div>
            )}
            {m.role === "assistant" && m.revised && (
              <>
                {m.status === "pending" ? (
                  <CopyProposalActions onKeep={() => ctrl.keep(fid, i)} onCancel={() => ctrl.cancel(fid, i)} />
                ) : (
                  <CopyAppliedNote canceled={m.status === "canceled"} remembered={m.remembered} />
                )}
              </>
            )}
          </div>
        ))}

        {session.loading && <CopyLoadingLine />}
        {session.error && !session.loading && (
          <CopyErrorLine message={session.error} onRetry={() => ctrl.retry(fid)} />
        )}
      </div>

      <div className="border-t border-border-neutral-default p-3">
        <ReferenceTray r={refs} />
        <CopyComposer
          value={input}
          onChange={setInput}
          onSend={() => send(input)}
          busy={session.loading}
          autoFocus
          canSendEmpty={refs.refs.length > 0}
          onPaste={refs.onPaste}
          leading={<ReferenceButton r={refs} disabled={session.loading} />}
        />
      </div>
    </div>
  )
}
