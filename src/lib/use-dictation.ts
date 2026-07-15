"use client"

/**
 * useDictation — the shared speech-to-text state machine behind the home page's
 * "התחלה מרעיון" mic (Notion bug 38a4d905: "לא מצליחה להקליט כאן בעמוד מה ניצור היום").
 *
 * Both design variants (see `idea-dictation.tsx`) run on THIS hook — they differ
 * only in how they render it. Anything that isn't presentation lives here so the
 * two variants can never drift apart behaviourally.
 *
 * Why Web Speech and not MediaRecorder → server:
 *   `media-panel.tsx` posts audio to `/api/transcribe`, but that route does not
 *   exist in this repo — the record-then-transcribe path has no backend at all.
 *   `workflow-card.tsx` already ships working Hebrew dictation on the Web Speech
 *   API with no server and no per-minute cost, so that is the engine we reuse.
 *   We deliberately drop workflow-card's modal + device picker (too heavy for a
 *   "just say your idea" card) and its `alert()` (not this product's language).
 *
 * Zero side effects: no network, no DB writes, no paid API. Recognition runs
 * entirely in the browser.
 */

import { useCallback, useEffect, useRef, useState } from "react"

/**
 * The states the bug actually touches. `denied` and `unsupported` are first-class
 * states, not afterthoughts — they are the two ways the reporter's mic can fail
 * silently today.
 */
export type DictationState =
  | "idle"
  | "recording"
  | "denied"
  | "unsupported"
  | "error"

export type DictationController = {
  state: DictationState
  /** Live, not-yet-final words. Shown muted so the user sees she's being heard. */
  interim: string
  /** Seconds elapsed in the current recording, for the timer readout. */
  elapsed: number
  start: () => void
  stop: () => void
  /** Returns from a denied/unsupported/error surface back to idle. */
  dismiss: () => void
}

function getSpeechRecognition(): SpeechRecognitionConstructor | undefined {
  if (typeof window === "undefined") return undefined
  return window.SpeechRecognition || window.webkitSpeechRecognition
}

/** Formats elapsed seconds as m:ss. Latin digits — Hebrew uses them for time too. */
export function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

/**
 * @param onCommit  Called with each finalised phrase. The caller decides how it
 *                  composes with existing text (the home page appends).
 */
export function useDictation(onCommit: (finalText: string) => void): DictationController {
  const [state, setState] = useState<DictationState>("idle")
  const [interim, setInterim] = useState("")
  const [elapsed, setElapsed] = useState(0)

  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // `stop()` and the auto-restart in `onend` both need to know the live intent,
  // which a state variable can't give them from inside a stale closure.
  const wantsToRecordRef = useRef(false)
  // Keep the latest onCommit without re-subscribing recognition handlers. Synced
  // in an effect rather than during render; `start` only ever runs from an event
  // handler, which is always after the effect has committed.
  const onCommitRef = useRef(onCommit)
  useEffect(() => {
    onCommitRef.current = onCommit
  }, [onCommit])

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const teardown = useCallback(() => {
    wantsToRecordRef.current = false
    const recognition = recognitionRef.current
    if (recognition) {
      // Drop handlers before stopping so the auto-restart in `onend` can't fire.
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
      try {
        recognition.stop()
      } catch {
        // Already stopped — nothing to do.
      }
    }
    recognitionRef.current = null
    clearTimer()
    setInterim("")
  }, [clearTimer])

  // Never leave a hot mic behind on unmount/navigation.
  useEffect(() => teardown, [teardown])

  const stop = useCallback(() => {
    teardown()
    setState("idle")
    setElapsed(0)
  }, [teardown])

  const dismiss = useCallback(() => setState("idle"), [])

  const start = useCallback(() => {
    const SpeechRecognitionCtor = getSpeechRecognition()
    if (!SpeechRecognitionCtor) {
      // Inline surface, never alert() — the reporter's browser may simply not
      // support this, and she deserves to be told so on the card.
      setState("unsupported")
      return
    }

    const recognition = new SpeechRecognitionCtor()
    recognition.lang = "he-IL"
    recognition.continuous = true
    recognition.interimResults = true

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalText = ""
      let interimText = ""
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) finalText += result[0].transcript
        else interimText += result[0].transcript
      }
      if (finalText) onCommitRef.current(finalText.trim())
      setInterim(interimText)
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      // "aborted" is what a normal user-initiated stop looks like — not an error.
      if (event.error === "aborted") return
      teardown()
      setElapsed(0)
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setState("denied")
      } else if (event.error === "no-speech") {
        // Nothing was said; silently return to idle rather than scolding her.
        setState("idle")
      } else {
        setState("error")
      }
    }

    recognition.onend = () => {
      // Chrome ends the session on its own after a pause. If she hasn't pressed
      // stop, transparently resume so a long thought isn't cut off mid-sentence.
      if (!wantsToRecordRef.current) return
      try {
        recognition.start()
      } catch {
        teardown()
        setState("idle")
        setElapsed(0)
      }
    }

    try {
      recognition.start()
    } catch {
      setState("error")
      return
    }

    recognitionRef.current = recognition
    wantsToRecordRef.current = true
    setState("recording")
    setInterim("")
    setElapsed(0)
    timerRef.current = setInterval(() => setElapsed((t) => t + 1), 1000)
  }, [teardown])

  return { state, interim, elapsed, start, stop, dismiss }
}
