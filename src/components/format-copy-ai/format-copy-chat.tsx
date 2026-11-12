"use client"

import { BidiText } from "@/components/bidi-text"

import { useEffect, useRef } from "react"
import { X } from "lucide-react"
import { AiSparkle } from "@/components/ai-refine-button"
import { COPY_NOUN, type CopyFormat } from "@/lib/format-copy-refine"
import { useQaFixes1112 } from "@/lib/use-scheduling-access"

/**
 * The chat edits the words only, so it says so (Hani, 2026-11-12): "עריכת
 * הטקסט של הסטורי", not "עריכת הסטורי".
 */
const TEXT_NOUN: Record<CopyFormat, string> = {
  ...COPY_NOUN,
  carousel: "הטקסט של הקרוסלה",
  story: "הטקסט של הסטורי",
}
import { AiChatNewButton } from "@/components/ai-chat-new-button"
import { AiChatArchiveButton } from "@/components/ai-chat-archive-button"
import { useWatchChat } from "@/lib/ai-chat-session-store"
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
  const qa = useQaFixes1112() === true
  const nouns = qa ? TEXT_NOUN : COPY_NOUN
  const scrollRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  // Stays open until she presses X — an outside click doesn't close it (Hani, 2026-11-09).
  const session = fid ? ctrl.session(fid) : null
  // While shown, a reply lands here — nothing to reopen (lib/ai-chat-reveal).
  useWatchChat(fid ? ctrl.chatKey(fid) : null)
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

  // The half-typed text is kept with the conversation (ctrl.input); ctrl.send clears it.
  const input = ctrl.input(fid)
  const send = (text: string) => {
    const attached = refs.refs
    if (!text.trim() && !attached.length) return
    ctrl.send(fid, text.trim() || REFERENCE_ONLY_INSTRUCTION, attached)
    refs.clear()
  }
  const fresh = session.messages.length === 0

  return (
    <div
      ref={panelRef}
      data-demo="copy-ai-panel"
      dir="rtl"
      role="dialog"
      aria-label={`עריכת ${nouns[fid]} עם AI`}
      {...refs.dropProps}
      className={`${floating ? "fixed bottom-6 right-6 z-50 max-h-[72vh]" : "relative max-h-[560px]"} flex w-[380px] flex-col overflow-hidden rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 shadow-xl`}
    >
      <ReferenceDropHint show={refs.dragging} />
      <div className="flex items-center gap-2 border-b border-border-neutral-default bg-bg-surface px-4 py-3">
        <AiSparkle />
        <span className="text-small-bold text-text-primary-default">עריכת {nouns[fid]}</span>
        <div className="ms-auto flex items-center gap-1">
          <AiChatArchiveButton chatKey={ctrl.chatKey(fid)} disabled={session.loading} />
          {!fresh && <AiChatNewButton disabled={session.loading} onClick={() => ctrl.reset(fid)} />}
          <button
            type="button"
            onClick={ctrl.close}
            aria-label="סגירה"
            className="inline-flex size-7 items-center justify-center rounded-md text-text-neutral-default hover:bg-gray-95 dark:hover:bg-gray-20 hover:text-text-primary-default transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        <div className="flex flex-col items-end gap-2">
          <div className="max-w-[85%] rounded-2xl rounded-se-sm bg-bg-surface px-3 py-2 text-small leading-relaxed text-text-primary-default">
            מה לשנות ב{qa ? nouns[fid].slice(1) : nouns[fid]}? כתבו לי, או בחרו אחת מההצעות.
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
                <BidiText text={m.content} />
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
          onChange={(v) => ctrl.setInput(fid, v)}
          onSend={() => send(input)}
          busy={session.loading}
          autoFocus
          canSendEmpty={refs.refs.length > 0}
          onPaste={refs.onPaste}
          beforeSend={<ReferenceButton r={refs} disabled={session.loading} />}
        />
      </div>
    </div>
  )
}
