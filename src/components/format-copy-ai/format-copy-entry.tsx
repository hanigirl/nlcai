"use client"

import { useState } from "react"
import { X } from "lucide-react"
import { AiRefineButton, AiSparkle } from "@/components/ai-refine-button"
import { COPY_NOUN, type CopyFormat } from "@/lib/format-copy-refine"
import type { FormatCopyAiController } from "./use-format-copy-ai"
import {
  CopyAppliedNote,
  CopyChangeBadge,
  CopyComposer,
  CopyErrorLine,
  CopyLoadingLine,
  CopyMediaNote,
  CopyProposalActions,
  CopySuggestionChips,
} from "./copy-ai-parts"

/**
 * What a format card shows under its text, for both directions.
 *
 * A: the ✨ "עריכה עם AI" button only — the conversation opens in the docked
 *    panel (FormatCopyChat).
 * B: the same button unfolds IN PLACE into a small AI box inside the card:
 *    chips, one request, the result with keep/undo, right under the text it
 *    changed. No panel, no thread — only the latest exchange is kept.
 */
export function FormatCopyEntry({
  ctrl,
  fid,
  hasMedia,
}: {
  ctrl: FormatCopyAiController
  fid: CopyFormat
  hasMedia: boolean
}) {
  const session = ctrl.session(fid)
  const isOpen = ctrl.activeFid === fid

  if (ctrl.variant === "a" || !isOpen) {
    return (
      <div
        data-copy-entry={fid}
        className="flex flex-col gap-2"
        // The canvas pans on mousedown; keep a click on the button a click.
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <AiRefineButton
          busy={session.loading}
          onClick={() => (isOpen ? ctrl.close() : ctrl.open(fid))}
          label="עריכה עם AI"
          className="w-full rounded-[10px]"
        />
        {ctrl.variant === "a" && isOpen && hasMedia && <CopyMediaNote />}
      </div>
    )
  }

  return <InlineCopyBox ctrl={ctrl} fid={fid} hasMedia={hasMedia} />
}

function InlineCopyBox({
  ctrl,
  fid,
  hasMedia,
}: {
  ctrl: FormatCopyAiController
  fid: CopyFormat
  hasMedia: boolean
}) {
  const [input, setInput] = useState("")
  const session = ctrl.session(fid)
  const pending = ctrl.pendingIndex(fid)
  // Only the latest exchange stays on screen — the card is the history.
  const last = [...session.messages].reverse().find((m) => m.role === "assistant")
  const lastIndex = last ? session.messages.lastIndexOf(last) : -1
  const lastAsk = [...session.messages].reverse().find((m) => m.role === "user")
  const send = (text: string) => {
    ctrl.send(fid, text)
    setInput("")
  }

  return (
    <div
      data-copy-entry={fid}
      role="group"
      aria-label={`עריכת ${COPY_NOUN[fid]} עם AI`}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className="flex flex-col gap-3 rounded-[12px] border border-border-neutral-default bg-bg-surface p-3"
    >
      <div className="flex items-center gap-2">
        <AiSparkle className="size-4" />
        <span className="text-small-bold text-text-primary-default">עריכה עם AI</span>
        <button
          type="button"
          onClick={ctrl.close}
          aria-label="סגירה"
          className="ms-auto inline-flex size-7 items-center justify-center rounded-md text-text-neutral-default hover:bg-gray-95 dark:hover:bg-gray-20 hover:text-text-primary-default transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
        >
          <X className="size-4" />
        </button>
      </div>

      {hasMedia && <CopyMediaNote />}

      {session.loading ? (
        <div className="flex flex-col gap-1.5">
          {lastAsk && <span className="text-xs-body text-text-neutral-default">״{lastAsk.content}״</span>}
          <CopyLoadingLine />
        </div>
      ) : session.error ? (
        <CopyErrorLine message={session.error} onRetry={() => ctrl.retry(fid)} />
      ) : last && last.revised && lastIndex === pending ? (
        <div className="flex flex-col gap-2 rounded-[10px] bg-white dark:bg-gray-10 p-3">
          <p className="text-small leading-relaxed text-text-primary-default">{last.content}</p>
          <CopyChangeBadge change={last.change} />
          <p className="text-xs-body text-text-neutral-default">השינוי כבר מוצג בטקסט למעלה.</p>
          <CopyProposalActions onKeep={() => ctrl.keep(fid, lastIndex)} onCancel={() => ctrl.cancel(fid, lastIndex)} />
        </div>
      ) : (
        <>
          {last?.revised && <CopyAppliedNote canceled={last.status === "canceled"} />}
          <CopySuggestionChips fid={fid} onPick={send} />
        </>
      )}

      <CopyComposer
        value={input}
        onChange={setInput}
        onSend={() => send(input)}
        busy={session.loading}
        placeholder={pending >= 0 ? "עוד שינוי?" : "מה לשנות?"}
        autoFocus
      />
    </div>
  )
}
