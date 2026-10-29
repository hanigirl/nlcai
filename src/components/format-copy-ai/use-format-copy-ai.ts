"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  requestFormatCopyRefine,
  type CopyFormat,
  type CopyRefineResult,
  type CopyRefineTurn,
} from "@/lib/format-copy-refine"

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
  /** User turns: reference images she attached (shown in her bubble). */
  images?: string[]
  /** Assistant turns: the full revised text that was previewed in the card. */
  revised?: string
  /** Assistant turns: the text to restore on "ביטול". */
  revertTo?: string
  status?: "pending" | "applied" | "canceled"
  /** Kept with "שמירת השינוי" — and so learned for next time. */
  remembered?: boolean
}

export interface CopyAiSession {
  messages: CopyAiMessage[]
  loading: boolean
  error: string
  /** The last instruction sent — what "ניסיון חוזר" re-sends after an error. */
  lastInstruction: string
  /** …and the references that went with it. */
  lastReferences?: string[]
}

const EMPTY_SESSION: CopyAiSession = { messages: [], loading: false, error: "", lastInstruction: "" }

export type CopyRefineResponder = (input: {
  format: CopyFormat
  currentText: string
  hook?: string
  messages: CopyRefineTurn[]
  references?: string[]
}) => Promise<CopyRefineResult>

export interface FormatCopyAiController {
  /** The format whose AI edit panel is open. */
  activeFid: CopyFormat | null
  session: (fid: CopyFormat) => CopyAiSession
  open: (fid: CopyFormat) => void
  close: () => void
  /** `references`: screenshots attached to this message (sent with it only). */
  send: (fid: CopyFormat, instruction: string, references?: string[]) => void
  retry: (fid: CopyFormat) => void
  keep: (fid: CopyFormat, index: number) => void
  cancel: (fid: CopyFormat, index: number) => void
  /** Index of the proposal still waiting for keep/undo, or -1. */
  pendingIndex: (fid: CopyFormat) => number
  /** The AI is writing a revision for this format (any id; false for non-copy ids). */
  isBusy: (fid: string) => boolean
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
}

export function useFormatCopyAi({ getText, setText, hook, onVerdict, responder }: Options): FormatCopyAiController {
  const [activeFid, setActiveFid] = useState<CopyFormat | null>(null)
  const [sessions, setSessions] = useState<Partial<Record<CopyFormat, CopyAiSession>>>({})
  const sessionsRef = useRef(sessions)
  useEffect(() => {
    sessionsRef.current = sessions
  })
  const getTextRef = useRef(getText)
  useEffect(() => {
    getTextRef.current = getText
  })
  const onVerdictRef = useRef(onVerdict)
  useEffect(() => {
    onVerdictRef.current = onVerdict
  })
  // Revisions already learned, so a second tap can't log the same one twice. Keyed `${fid}:${index}`.
  const reportedRef = useRef<Set<string>>(new Set())

  /** The user request that produced the assistant turn at `index`. */
  const report = useCallback((fid: CopyFormat, index: number, outcome: "accepted" | "rejected") => {
    const key = `${fid}:${index}`
    const msgs = sessionsRef.current[fid]?.messages ?? []
    const msg = msgs[index]
    if (!msg?.revised || msg.revertTo === undefined || reportedRef.current.has(key)) return
    reportedRef.current.add(key)
    const ask = [...msgs.slice(0, index)].reverse().find((m) => m.role === "user")
    onVerdictRef.current?.(fid, msg, ask?.content ?? "", outcome)
  }, [])

  const patch = useCallback((fid: CopyFormat, fn: (s: CopyAiSession) => CopyAiSession) => {
    setSessions((prev) => ({ ...prev, [fid]: fn(prev[fid] ?? EMPTY_SESSION) }))
  }, [])

  const session = useCallback((fid: CopyFormat) => sessions[fid] ?? EMPTY_SESSION, [sessions])

  const pendingIndex = useCallback(
    (fid: CopyFormat) => (sessions[fid]?.messages ?? []).findIndex((m) => m.status === "pending"),
    [sessions],
  )

  const run = useCallback(
    async (fid: CopyFormat, instruction: string, history: CopyAiMessage[], references: string[] = []) => {
      const before = getTextRef.current(fid)
      patch(fid, (s) => ({ ...s, loading: true, error: "", lastInstruction: instruction, lastReferences: references }))
      try {
        const ask = responder ?? requestFormatCopyRefine
        const { reply, revisedText } = await ask({
          format: fid,
          currentText: before,
          hook,
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          ...(references.length ? { references } : {}),
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
    (fid: CopyFormat, instruction: string, references: string[] = []) => {
      const text = instruction.trim()
      const current = sessionsRef.current[fid] ?? EMPTY_SESSION
      if (!text || current.loading) return
      // Asking for the next change keeps the previous proposal — its text is
      // already the baseline the next revision builds on.
      const kept = current.messages.map((m) => (m.status === "pending" ? { ...m, status: "applied" as const } : m))
      const next: CopyAiMessage[] = [
        ...kept,
        { role: "user", content: text, ...(references.length ? { images: references } : {}) },
      ]
      patch(fid, (s) => ({ ...s, messages: next }))
      void run(fid, text, next, references)
    },
    [patch, run],
  )

  const retry = useCallback(
    (fid: CopyFormat) => {
      const s = sessionsRef.current[fid]
      if (!s?.lastInstruction || s.loading) return
      void run(fid, s.lastInstruction, s.messages, s.lastReferences)
    },
    [run],
  )

  const keep = useCallback(
    (fid: CopyFormat, index: number) => {
      // Saving the change also learns it — the panel says so in green.
      report(fid, index, "accepted")
      patch(fid, (s) => ({
        ...s,
        messages: s.messages.map((m, i) => (i === index ? { ...m, status: "applied", remembered: true } : m)),
      }))
    },
    [patch, report],
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

  const isBusy = useCallback(
    (fid: string) => !!sessions[fid as CopyFormat]?.loading,
    [sessions],
  )

  const open = useCallback((fid: CopyFormat) => setActiveFid(fid), [])
  const close = useCallback(() => setActiveFid(null), [])

  return { activeFid, session, open, close, send, retry, keep, cancel, pendingIndex, isBusy }
}
