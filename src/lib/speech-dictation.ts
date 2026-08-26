// Long-form Hebrew dictation on top of the browser's Web Speech API.
//
// The API is not built for long recordings and this is the part that keeps
// biting us. Chrome ends a recognition session on its own — after roughly
// 30-60 seconds, and again every time the speaker pauses to think — and it
// signals that in two different ways that both look like "the user finished":
//
//   1. `onerror` with error "no-speech" whenever a pause runs long.
//   2. `onend`, unprompted, when the session times out.
//
// Treating either one as "stop recording" is why dictation kept dying mid-
// sentence and silently dropping everything after the first minute. There is
// no duration setting to raise; the only fix is to notice the session ended
// and immediately open a new one, which is what this module does.
//
// Both the home-page mic and the core-post card go through here so the restart
// logic exists once. It was written twice before, and was wrong in both.

/**
 * Session-ended signals that mean "start another one", not "the user is done".
 * Everything else — a denied permission, a disconnected microphone — is real
 * and must surface, otherwise we spin forever against a mic that will never
 * produce audio.
 */
const RECOVERABLE_ERRORS = new Set(["no-speech", "aborted"])

const FATAL_MESSAGES: Record<string, string> = {
  "not-allowed": "אין הרשאה למיקרופון. אפשרו גישה בהגדרות הדפדפן.",
  "service-not-allowed": "אין הרשאה למיקרופון. אפשרו גישה בהגדרות הדפדפן.",
  "audio-capture": "לא נמצא מיקרופון. בדקו שהוא מחובר.",
}

// A restart that dies instantly, over and over, is a loop rather than a
// recovery — bail out instead of hammering the speech service forever.
const RAPID_RESTART_MS = 500
const MAX_RAPID_RESTARTS = 5

export interface DictationHandle {
  /** Stops for good. Safe to call more than once. */
  stop: () => void
}

export interface DictationOptions {
  lang?: string
  /** Called with each finalised chunk of speech, already trimmed. */
  onFinalText: (text: string) => void
  /** Called once when dictation cannot continue. The session is already over. */
  onFatalError: (message: string) => void
}

/**
 * Starts dictating. Returns null when the browser has no Web Speech API — the
 * caller should tell the user to switch browsers.
 */
export function startDictation({
  lang = "he-IL",
  onFinalText,
  onFatalError,
}: DictationOptions): DictationHandle | null {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!Ctor) return null

  // The single source of truth for "should this still be running". Deliberately
  // a closure variable and not React state: the handlers below are registered
  // once and would otherwise capture the value state had at registration time,
  // which is exactly the bug that stopped the core-post recorder from ever
  // restarting — it read `isRecording` as false forever.
  let live = true
  let lastStartedAt = Date.now()
  let rapidRestarts = 0

  const recognition = new Ctor()
  recognition.lang = lang
  recognition.continuous = true
  recognition.interimResults = true

  const finish = (message?: string) => {
    if (!live) return
    live = false
    try {
      recognition.stop()
    } catch {
      // Already stopped — nothing to unwind.
    }
    if (message) onFatalError(message)
  }

  recognition.onresult = (event: SpeechRecognitionEvent) => {
    // A result means the session is healthy, so the rapid-restart guard resets.
    rapidRestarts = 0
    let finalText = ""
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) finalText += event.results[i][0].transcript
    }
    const trimmed = finalText.trim()
    if (trimmed) onFinalText(trimmed)
  }

  recognition.onerror = (event: Event) => {
    const code = (event as SpeechRecognitionErrorEvent).error
    // A pause in speech is not an error worth ending on. Let onend restart.
    if (RECOVERABLE_ERRORS.has(code)) return
    finish(FATAL_MESSAGES[code] ?? "ההקלטה נקטעה. נסו שוב.")
  }

  recognition.onend = () => {
    if (!live) return

    const sessionMs = Date.now() - lastStartedAt
    rapidRestarts = sessionMs < RAPID_RESTART_MS ? rapidRestarts + 1 : 0
    if (rapidRestarts >= MAX_RAPID_RESTARTS) {
      finish("ההקלטה נקטעה. נסו שוב.")
      return
    }

    try {
      lastStartedAt = Date.now()
      recognition.start()
    } catch {
      finish("ההקלטה נקטעה. נסו שוב.")
    }
  }

  recognition.start()

  return {
    stop: () => finish(),
  }
}
