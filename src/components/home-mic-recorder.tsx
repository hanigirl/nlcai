"use client"

/**
 * HomeMicRecorder — voice capture for the home-page "התחלה מרעיון" idea box.
 *
 * Fixes Notion task 3b24d905: the home-page mic was a bare <Mic> icon with no
 * onClick (dead), and visually just an icon — not a round button with a hover
 * state. This component turns it into a round button (gray hover — "האפור שלנו")
 * that actually records the user's voice and transcribes it (Hebrew, he-IL)
 * straight into the idea textarea, mirroring the mic on the core-post editor
 * (WorkflowCard). The recording + device-selection logic is shared here; the
 * two variants only differ in HOW they surface it (see below), so the treatment
 * lives in ONE component instead of being duplicated per variant.
 *
 * Variant "a" — מודאל בחירה (modal-first): click opens a centered dialog with a
 *   device picker + a big record button. Identical mental model to פוסט ליבה.
 * Variant "b" — הקלטה מיידית (record-first inline): click starts recording
 *   immediately, inline in the card, with live transcription into the textarea;
 *   the device picker is demoted to a small secondary control.
 *
 * SAFETY: uses the browser-local Web Speech API only (like WorkflowCard). No
 * server call, no API credits, no DB writes. Safe to open on a live link.
 *
 * The `preview` prop is a REVIEW-ONLY affordance: it renders a given visual
 * state (recording / error) with seeded data and WITHOUT touching the mic, so a
 * reviewer can inspect every state without granting mic permission. With
 * preview unset the component is fully live.
 */

import { useState, useRef, useEffect, useCallback } from "react"
import { Mic, Square, X, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export type MicVariant = "a" | "b"
export type MicPreview = "recording" | "error" | null

interface HomeMicRecorderProps {
  variant: MicVariant
  /** The idea textarea value — transcribed speech is appended to it. */
  value: string
  onChange: (value: string) => void
  /** Review-only: force a visual state with seeded data, no real mic access. */
  preview?: MicPreview
}

const PREVIEW_DEVICES = [
  { deviceId: "default", label: "מיקרופון ברירת מחדל (מובנה)" } as MediaDeviceInfo,
  { deviceId: "ext", label: "AirPods" } as MediaDeviceInfo,
]

export function HomeMicRecorder({
  variant,
  value,
  onChange,
  preview = null,
}: HomeMicRecorderProps) {
  const [showDeviceDialog, setShowDeviceDialog] = useState(false)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState("")
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  // Keep the latest textarea value available inside async recognition
  // callbacks without re-registering them on every keystroke.
  const valueRef = useRef(value)
  useEffect(() => {
    valueRef.current = value
  }, [value])

  // --- Review-only preview: paint the state, don't touch the mic ----------
  const previewRecording = preview === "recording"
  const previewError = preview === "error"
  const showRecording = previewRecording || isRecording
  const displayTime = previewRecording ? 7 : recordingTime
  const displayError = previewError
    ? "לא ניתן לגשת למיקרופון. אפשרו גישה בהגדרות הדפדפן."
    : error
  const displayDevices = preview ? PREVIEW_DEVICES : devices

  const loadDevices = useCallback(async () => {
    if (preview) {
      setDevices(PREVIEW_DEVICES)
      setSelectedDeviceId(PREVIEW_DEVICES[0].deviceId)
      return
    }
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true })
      const all = await navigator.mediaDevices.enumerateDevices()
      const audioInputs = all.filter((d) => d.kind === "audioinput")
      setDevices(audioInputs)
      if (audioInputs.length > 0 && !selectedDeviceId) {
        setSelectedDeviceId(audioInputs[0].deviceId)
      }
    } catch {
      setError("לא ניתן לגשת למיקרופון. אפשרו גישה בהגדרות הדפדפן.")
    }
  }, [preview, selectedDeviceId])

  useEffect(() => {
    if (showDeviceDialog) loadDevices()
  }, [showDeviceDialog, loadDevices])

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop()
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  const startRecording = () => {
    if (preview) return // review-only: never touch the mic
    const SpeechRecognitionCtor =
      window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognitionCtor) {
      setError("הדפדפן לא תומך בזיהוי דיבור. נסו בכרום או ב-Edge.")
      return
    }
    setError(null)

    const recognition = new SpeechRecognitionCtor()
    recognition.lang = "he-IL"
    recognition.continuous = true
    recognition.interimResults = true

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalTranscript = ""
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript
        }
      }
      if (finalTranscript) {
        const base = valueRef.current
        const separator = base && !base.endsWith(" ") ? " " : ""
        onChange(base + separator + finalTranscript.trim())
      }
    }
    recognition.onerror = () => stopRecording()
    recognition.onend = () => {
      // Auto-restart while the user still wants to record (browsers cut the
      // session after a pause).
      if (recognitionRef.current) {
        try {
          recognition.start()
        } catch {
          stopRecording()
        }
      }
    }

    recognition.start()
    recognitionRef.current = recognition
    setIsRecording(true)
    setRecordingTime(0)
    timerRef.current = setInterval(() => setRecordingTime((t) => t + 1), 1000)
  }

  const stopRecording = () => {
    recognitionRef.current = null
    setIsRecording(false)
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, "0")}`
  }

  // Shared round-button base. Gray hover ("האפור שלנו"), on-system tokens.
  const roundBtn =
    "flex items-center justify-center rounded-full transition-colors text-text-neutral-default hover:bg-gray-95 dark:hover:bg-gray-20 hover:text-text-primary-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-neutral-default"

  // ---- Shared device-picker dialog (used by both variants) ---------------
  const deviceDialog = (
    <Dialog open={showDeviceDialog} onOpenChange={setShowDeviceDialog}>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>בחירת מיקרופון</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <label className="text-small-bold text-text-primary-default">
            מאיזה מיקרופון להקליט?
          </label>
          <select
            value={selectedDeviceId}
            onChange={(e) => setSelectedDeviceId(e.target.value)}
            className="h-10 rounded-lg border border-border-neutral-default bg-white dark:bg-gray-10 px-3 text-small text-text-primary-default"
          >
            {displayDevices.length === 0 && (
              <option value="">מיקרופון ברירת מחדל (מובנה)</option>
            )}
            {displayDevices.map((device, i) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `מיקרופון ${i + 1}`}
              </option>
            ))}
          </select>
          <p className="text-xs-body text-text-neutral-default">
            ההקלטה מתומללת אצלכם בדפדפן בלבד — שום דבר לא נשלח לשרת.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )

  // ======================================================================
  // Variant A — מודאל בחירה (modal-first): mirrors the פוסט ליבה mic.
  // ======================================================================
  if (variant === "a") {
    return (
      <>
        <button
          type="button"
          aria-label="הקלטה קולית"
          onClick={() => setShowDeviceDialog(true)}
          className={cn(roundBtn, "size-9")}
        >
          <Mic className="size-4" />
        </button>

        <Dialog
          open={showDeviceDialog}
          onOpenChange={(open) => {
            if (!open && isRecording) stopRecording()
            setShowDeviceDialog(open)
          }}
        >
          <DialogContent dir="rtl" className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>הקלטה קולית</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-small-bold text-text-primary-default">
                  בחירת מיקרופון
                </label>
                <select
                  value={selectedDeviceId}
                  onChange={(e) => setSelectedDeviceId(e.target.value)}
                  disabled={showRecording}
                  className="h-10 rounded-lg border border-border-neutral-default bg-white dark:bg-gray-10 px-3 text-small text-text-primary-default disabled:opacity-60"
                >
                  {displayDevices.length === 0 && (
                    <option value="">מיקרופון ברירת מחדל (מובנה)</option>
                  )}
                  {displayDevices.map((device, i) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `מיקרופון ${i + 1}`}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col items-center gap-4 py-4">
                {showRecording && (
                  <div className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-p-bold text-text-primary-default font-mono">
                      {formatTime(displayTime)}
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={showRecording ? stopRecording : startRecording}
                  className={cn(
                    "size-16 rounded-full flex items-center justify-center transition-all text-white",
                    showRecording
                      ? "bg-red-500 hover:bg-red-600"
                      : "bg-button-primary-default hover:bg-button-primary-hover"
                  )}
                >
                  {showRecording ? (
                    <Square className="size-6" />
                  ) : (
                    <Mic className="size-6" />
                  )}
                </button>
                <p className="text-small text-text-neutral-default text-center">
                  {showRecording ? "מקליט... לחצו לעצור" : "לחצו כדי להתחיל הקלטה"}
                </p>
                {displayError && (
                  <p className="text-small text-button-destructive-default text-center">
                    {displayError}
                  </p>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </>
    )
  }

  // ======================================================================
  // Variant B — הקלטה מיידית (record-first inline): one tap to talk.
  // ======================================================================
  if (showRecording) {
    return (
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="עצירת הקלטה"
          onClick={stopRecording}
          className="size-9 rounded-full flex items-center justify-center bg-red-500 hover:bg-red-600 text-white transition-colors"
        >
          <Square className="size-4" />
        </button>
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-small-bold text-text-primary-default font-mono">
            {formatTime(displayTime)}
          </span>
          <span className="text-small text-text-neutral-default">
            מקליט ומתמלל...
          </span>
        </div>
        <button
          type="button"
          aria-label="ביטול הקלטה"
          onClick={stopRecording}
          className={cn(roundBtn, "size-8")}
        >
          <X className="size-4" />
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="הקלטה קולית"
          onClick={startRecording}
          className={cn(roundBtn, "size-9")}
        >
          <Mic className="size-4" />
        </button>
        <button
          type="button"
          aria-label="בחירת מיקרופון"
          onClick={() => setShowDeviceDialog(true)}
          className={cn(roundBtn, "size-6")}
        >
          <ChevronDown className="size-3.5" />
        </button>
      </div>
      {displayError && (
        <p className="text-xs-body text-button-destructive-default">
          {displayError}
        </p>
      )}
      {deviceDialog}
    </div>
  )
}
