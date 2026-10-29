"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { aiErrorMessage } from "@/lib/ai-error-message"
import {
  requestFormatCopyRefine,
  COPY_NOUN,
  type CopyFormat,
  type CopyRefineResult,
  type CopyRefineTurn,
} from "@/lib/format-copy-refine"
import { clearChat, getChat, updateChat, useAiChatVersion, type AiChatSession } from "@/lib/ai-chat-session-store"
import { revealChatReply } from "@/lib/ai-chat-reveal"

/**
 * State for "עריכה עם AI" on the format copy cards — one session per format.
 * The ✨ button on a card opens FormatCopyChat (the docked panel the core post
 * uses), scoped to that format. Picked by Hani on 2026-10-29.
 *
 * Contract with the canvas (same as CorePostChat): the AI's revision is
 * written into the format card the moment it arrives, and "ביטול" writes the
 * previous text back.
 */

export interface CopyAiMessage {
  role: "user" | "assistant"
  content: string
  /** Assistant turns: the full revised text that was previewed in the card. */
  revised?: string
  /** Assistant turns: the text to restore on "ביטול". */
  revertTo?: string
  status?: "pending" | "applied" | "canceled"
  /** Kept with "שמירת השינוי" — and so learned for next time. */
  remembered?: boolean
  /** Its verdict already went to the writing-style memory. */
  reported?: boolean
}

export interface CopyAiSession {
  messages: CopyAiMessage[]
  loading: boolean
  error: string
  /** The last instruction sent — what "ניסיון חוזר" re-sends after an error. */
  lastInstruction: string
}

const EMPTY_SESSION: CopyAiSession = { messages: [], loading: false, error: "", lastInstruction: "" }

export type CopyRefineResponder = (input: {
  format: CopyFormat
  currentText: string
  hook?: string
  messages: CopyRefineTurn[]
}) => Promise<CopyRefineResult>

export interface FormatCopyAiController {
  /** The format whose AI edit panel is open. */
  activeFid: CopyFormat | null
  session: (fid: CopyFormat) => CopyAiSession
  open: (fid: CopyFormat) => void
  close: () => void
  send: (fid: CopyFormat, instruction: string) => void
  retry: (fid: CopyFormat) => void
  keep: (fid: CopyFormat, index: number) => void
  cancel: (fid: CopyFormat, index: number) => void
  /** Index of the proposal still waiting for keep/undo, or -1. */
  pendingIndex: (fid: CopyFormat) => number
  /** The AI is writing a revision for this format (any id; false for non-copy ids). */
  isBusy: (fid: string) => boolean
  /** What she typed in this format's panel and didn't send yet. */
  input: (fid: CopyFormat) => string
  setInput: (fid: CopyFormat, value: string) => void
  /** "שיחה חדשה": forget this format's conversation. */
  reset: (fid: CopyFormat) => void
  /** This format's conversation in lib/ai-chat-session-store. */
  chatKey: (fid: CopyFormat) => string
}

interface Options {
  getText: (fid: CopyFormat) => string
  setText: (fid: CopyFormat, text: string) => void
  hook?: string
  /**
   * The writing-style memory signal. Called ONLY when she clicks "שמירת
   * השינוי" on a revision (Hani, 2026-10-29: "שמור שינויים ישמור אוטומטית
   * לפעמים הבאות"). Undo, or moving on without saving, teaches nothing.
   */
  onVerdict?: (fid: CopyFormat, msg: CopyAiMessage, instruction: string, outcome: "accepted" | "rejected") => void
  /** Test page only: answer locally instead of calling the route. */
  responder?: CopyRefineResponder
  /** Which post the conversations belong to (one per post + format). */
  scope?: string
}

/** What the session store keeps besides the thread (lib/ai-chat-session-store). */
interface CopyChatExtra {
  error: string
  lastInstruction: string
}
type CopyChat = AiChatSession<CopyAiMessage, CopyChatExtra>

const freshChat = (): CopyChat => ({ messages: [], input: "", busy: false, extra: { error: "", lastInstruction: "" } })
const patchKey = (key: string, fn: (s: CopyChat) => CopyChat) => updateChat(key, freshChat, fn)

export function useFormatCopyAi({ getText, setText, hook, onVerdict, responder, scope = "draft" }: Options): FormatCopyAiController {
  const [activeFid, setActiveFid] = useState<CopyFormat | null>(null)
  // The conversations live outside the page (lib/ai-chat-session-store): one
  // per post + format, kept through closing the panel, leaving the screen and
  // a reload; a request keeps running and writes its reply there.
  const version = useAiChatVersion()
  const keyOf = useCallback((fid: CopyFormat) => `copy:${scope}:${fid}`, [scope])
  const chatOf = useCallback(
    (fid: CopyFormat) => getChat<CopyAiMessage, CopyChatExtra>(keyOf(fid)),
    [keyOf],
  )
  const getTextRef = useRef(getText)
  useEffect(() => {
    getTextRef.current = getText
  })
  const onVerdictRef = useRef(onVerdict)
  useEffect(() => {
    onVerdictRef.current = onVerdict
  })

  /** The user request that produced the assistant turn at `index`. Learned once (`reported`). */
  const report = useCallback(
    (fid: CopyFormat, index: number, outcome: "accepted" | "rejected") => {
      const msgs = chatOf(fid)?.messages ?? []
      const msg = msgs[index]
      if (!msg?.revised || msg.revertTo === undefined || msg.reported) return
      const ask = [...msgs.slice(0, index)].reverse().find((m) => m.role === "user")
      onVerdictRef.current?.(fid, msg, ask?.content ?? "", outcome)
    },
    [chatOf],
  )

  const session = useCallback(
    (fid: CopyFormat): CopyAiSession => {
      const c = chatOf(fid)
      if (!c) return EMPTY_SESSION
      return { messages: c.messages, loading: c.busy, error: c.extra.error, lastInstruction: c.extra.lastInstruction }
    },
    // `version`: a conversation changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chatOf, version],
  )

  const pendingIndex = useCallback(
    (fid: CopyFormat) => (chatOf(fid)?.messages ?? []).findIndex((m) => m.status === "pending"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chatOf, version],
  )

  const run = useCallback(
    async (fid: CopyFormat, instruction: string, history: CopyAiMessage[]) => {
      // The reply belongs to this post's conversation even if the panel closes first.
      const key = keyOf(fid)
      const before = getTextRef.current(fid)
      patchKey(key, (s) => ({ ...s, busy: true, extra: { ...s.extra, error: "", lastInstruction: instruction } }))
      try {
        const ask = responder ?? requestFormatCopyRefine
        const { reply, revisedText } = await ask({
          format: fid,
          currentText: before,
          hook,
          messages: history.map((m) => ({ role: m.role, content: m.content })),
        })
        if (revisedText) setText(fid, revisedText)
        patchKey(key, (s) => ({
          ...s,
          busy: false,
          messages: [
            ...s.messages,
            {
              role: "assistant",
              content: reply,
              revised: revisedText || undefined,
              revertTo: revisedText ? before : undefined,
              status: revisedText ? "pending" : undefined,
            },
          ],
        }))
        // Closed meanwhile: this post's page reopens the panel on the reply.
        revealChatReply(key, `עריכת ${COPY_NOUN[fid]} מוכנה`)
      } catch (err) {
        patchKey(key, (s) => ({
          ...s,
          busy: false,
          extra: { ...s.extra, error: aiErrorMessage(err) },
        }))
        revealChatReply(key, `עריכת ${COPY_NOUN[fid]} לא הצליחה`)
      }
    },
     
    [hook, keyOf, responder, setText],
  )

  const send = useCallback(
    (fid: CopyFormat, instruction: string) => {
      const text = instruction.trim()
      const current = chatOf(fid) ?? freshChat()
      if (!text || current.busy) return
      // Asking for the next change keeps the previous proposal — its text is
      // already the baseline the next revision builds on.
      const kept = current.messages.map((m) => (m.status === "pending" ? { ...m, status: "applied" as const } : m))
      const next: CopyAiMessage[] = [...kept, { role: "user", content: text }]
      patchKey(keyOf(fid), (s) => ({ ...s, messages: next, input: "" }))
      void run(fid, text, next)
    },
     
    [chatOf, keyOf, run],
  )

  const retry = useCallback(
    (fid: CopyFormat) => {
      const s = chatOf(fid)
      if (!s?.extra.lastInstruction || s.busy) return
      void run(fid, s.extra.lastInstruction, s.messages)
    },
    [chatOf, run],
  )

  const keep = useCallback(
    (fid: CopyFormat, index: number) => {
      // Saving the change also learns it — the panel says so in green.
      report(fid, index, "accepted")
      patchKey(keyOf(fid), (s) => ({
        ...s,
        messages: s.messages.map((m, i) =>
          i === index ? { ...m, status: "applied", remembered: true, reported: true } : m,
        ),
      }))
    },
     
    [keyOf, report],
  )

  const cancel = useCallback(
    (fid: CopyFormat, index: number) => {
      const msg = chatOf(fid)?.messages[index]
      if (msg?.revertTo !== undefined) setText(fid, msg.revertTo)
      patchKey(keyOf(fid), (s) => ({
        ...s,
        messages: s.messages.map((m, i) => (i === index ? { ...m, status: "canceled" } : m)),
      }))
    },
     
    [chatOf, keyOf, setText],
  )

  const isBusy = useCallback(
    (fid: string) => !!chatOf(fid as CopyFormat)?.busy,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chatOf, version],
  )

  const open = useCallback(
    (fid: CopyFormat) => {
      setActiveFid(fid)
      // A revision that landed while the page was gone never reached the card — show it there now.
      const c = chatOf(fid)
      const pending = c && !c.busy ? c.messages.find((m) => m.status === "pending") : undefined
      const shown = getTextRef.current(fid)
      if (pending?.revised && pending.revertTo === shown && pending.revised !== shown) setText(fid, pending.revised)
    },
    [chatOf, setText],
  )
  const close = useCallback(() => setActiveFid(null), [])

  const input = useCallback(
    (fid: CopyFormat) => chatOf(fid)?.input ?? "",
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chatOf, version],
  )
  const setInput = useCallback(
    (fid: CopyFormat, value: string) => patchKey(keyOf(fid), (s) => ({ ...s, input: value })),
     
    [keyOf],
  )
  const reset = useCallback((fid: CopyFormat) => clearChat(keyOf(fid)), [keyOf])

  return { activeFid, session, open, close, send, retry, keep, cancel, pendingIndex, isBusy, input, setInput, reset, chatKey: keyOf }
}
