"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  describeCopyChange,
  requestFormatCopyRefine,
  type CopyFormat,
  type CopyRefineResult,
  type CopyRefineTurn,
} from "@/lib/format-copy-refine"

/**
 * State for "עריכה עם AI" on the format copy cards — one session per format,
 * shared by both review directions (A: docked chat panel, B: inline in the
 * card). The two directions differ in where the conversation lives and how
 * much of it is kept on screen; the engine underneath is the same, so the
 * comparison is about the interaction, not two implementations.
 *
 * Contract with the canvas (same as CorePostChat): the AI's revision is
 * written into the format card the moment it arrives, and "ביטול" writes the
 * previous text back.
 */

export type CopyAiVariant = "a" | "b"

/** The states a reviewer can land on directly (?state=…). */
export type CopyAiReviewState = "idle" | "open" | "generating" | "proposal" | "error"
export const COPY_AI_REVIEW_STATES: CopyAiReviewState[] = ["idle", "open", "generating", "proposal", "error"]

export interface CopyAiMessage {
  role: "user" | "assistant"
  content: string
  /** Assistant turns: the full revised text that was previewed in the card. */
  revised?: string
  /** Assistant turns: the text to restore on "ביטול". */
  revertTo?: string
  status?: "pending" | "applied" | "canceled"
  /** "6 שקופיות ← 4 שקופיות" — see describeCopyChange. */
  change?: string | null
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
  variant: CopyAiVariant
  /** The format whose AI edit is open (A: the panel, B: that card's box). */
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
}

interface Options {
  variant: CopyAiVariant
  getText: (fid: CopyFormat) => string
  setText: (fid: CopyFormat, text: string) => void
  hook?: string
  /** Review harness: answers locally instead of calling the route. */
  responder?: CopyRefineResponder
}

export function useFormatCopyAi({ variant, getText, setText, hook, responder }: Options): FormatCopyAiController {
  const [activeFid, setActiveFid] = useState<CopyFormat | null>(null)
  const [sessions, setSessions] = useState<Partial<Record<CopyFormat, CopyAiSession>>>({})
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions
  const getTextRef = useRef(getText)
  getTextRef.current = getText

  const patch = useCallback((fid: CopyFormat, fn: (s: CopyAiSession) => CopyAiSession) => {
    setSessions((prev) => ({ ...prev, [fid]: fn(prev[fid] ?? EMPTY_SESSION) }))
  }, [])

  const session = useCallback((fid: CopyFormat) => sessions[fid] ?? EMPTY_SESSION, [sessions])

  const pendingIndex = useCallback(
    (fid: CopyFormat) => (sessions[fid]?.messages ?? []).findIndex((m) => m.status === "pending"),
    [sessions],
  )

  const run = useCallback(
    async (fid: CopyFormat, instruction: string, history: CopyAiMessage[]) => {
      const before = getTextRef.current(fid)
      patch(fid, (s) => ({ ...s, loading: true, error: "", lastInstruction: instruction }))
      try {
        const ask = responder ?? requestFormatCopyRefine
        const { reply, revisedText } = await ask({
          format: fid,
          currentText: before,
          hook,
          messages: history.map((m) => ({ role: m.role, content: m.content })),
        })
        if (revisedText) setText(fid, revisedText)
        patch(fid, (s) => ({
          ...s,
          loading: false,
          messages: [
            ...s.messages,
            {
              role: "assistant",
              content: reply,
              revised: revisedText || undefined,
              revertTo: revisedText ? before : undefined,
              status: revisedText ? "pending" : undefined,
              change: revisedText ? describeCopyChange(fid, before, revisedText) : null,
            },
          ],
        }))
      } catch (err) {
        patch(fid, (s) => ({
          ...s,
          loading: false,
          error: err instanceof Error ? err.message : "משהו השתבש. נסו שוב.",
        }))
      }
    },
    [hook, patch, responder, setText],
  )

  const send = useCallback(
    (fid: CopyFormat, instruction: string) => {
      const text = instruction.trim()
      const current = sessionsRef.current[fid] ?? EMPTY_SESSION
      if (!text || current.loading) return
      // Asking for the next change keeps the previous proposal — its text is
      // already the baseline the next revision builds on.
      const kept = current.messages.map((m) => (m.status === "pending" ? { ...m, status: "applied" as const } : m))
      const next: CopyAiMessage[] = [...kept, { role: "user", content: text }]
      patch(fid, (s) => ({ ...s, messages: next }))
      void run(fid, text, next)
    },
    [patch, run],
  )

  const retry = useCallback(
    (fid: CopyFormat) => {
      const s = sessionsRef.current[fid]
      if (!s?.lastInstruction || s.loading) return
      void run(fid, s.lastInstruction, s.messages)
    },
    [run],
  )

  const keep = useCallback(
    (fid: CopyFormat, index: number) => {
      patch(fid, (s) => ({
        ...s,
        messages: s.messages.map((m, i) => (i === index ? { ...m, status: "applied" } : m)),
      }))
      toast.success("השינוי נשמר בטקסט")
    },
    [patch],
  )

  const cancel = useCallback(
    (fid: CopyFormat, index: number) => {
      const msg = sessionsRef.current[fid]?.messages[index]
      if (msg?.revertTo !== undefined) setText(fid, msg.revertTo)
      patch(fid, (s) => ({
        ...s,
        messages: s.messages.map((m, i) => (i === index ? { ...m, status: "canceled" } : m)),
      }))
    },
    [patch, setText],
  )

  const open = useCallback((fid: CopyFormat) => setActiveFid(fid), [])
  const close = useCallback(() => setActiveFid(null), [])

  return { variant, activeFid, session, open, close, send, retry, keep, cancel, pendingIndex }
}

/**
 * Review harness only: put the controller into one named state for one
 * format, so every state has its own link (?copyedit=a&state=error).
 * "generating" sends with a responder that never answers, so the loading
 * state holds still for as long as the reviewer looks at it.
 */
export function useApplyCopyAiReviewState(
  ctrl: FormatCopyAiController,
  state: CopyAiReviewState | null,
  fid: CopyFormat,
  instruction: string,
  ready: boolean,
) {
  const appliedRef = useRef<string>("")
  useEffect(() => {
    if (!ready || !state) return
    const key = `${ctrl.variant}:${state}`
    if (appliedRef.current === key) return
    appliedRef.current = key
    if (state === "idle") {
      ctrl.close()
      return
    }
    ctrl.open(fid)
    if (state === "open") return
    ctrl.send(fid, instruction)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, state, fid, instruction])
}
