"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Mic, MicOff, Square } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface WorkflowCardProps {
  title: string
  subtitle: string
  buttonLabel: string
  submitLabel?: string
  warningText?: string
  active?: boolean
  value?: string
  onChange?: (value: string) => void
  onFocus?: () => void
  onSubmit?: () => void
  className?: string
}

export function WorkflowCard({
  title,
  subtitle,
  buttonLabel,
  submitLabel = "תייצר לי הוקים",
  warningText,
  active = true,
  value,
  onChange,
  onFocus,
  onSubmit,
  className,
}: WorkflowCardProps) {
  const [showMicDialog, setShowMicDialog] = useState(false)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState("")
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  const loadDevices = useCallback(async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true })
      const allDevices = await navigator.mediaDevices.enumerateDevices()
      const audioInputs = allDevices.filter((d) => d.kind === "audioinput")
      setDevices(audioInputs)
      if (audioInputs.length > 0 && !selectedDeviceId) {
        setSelectedDeviceId(audioInputs[0].deviceId)
      }
    } catch {
      // mic permission denied
    }
  }, [selectedDeviceId])

  useEffect(() => {
    if (showMicDialog) {
      loadDevices()
    }
  }, [showMicDialog, loadDevices])

  const startRecording = () => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      alert("הדפדפן לא תומך בזיהוי דיבור")
      return
    }

    const recognition = new SpeechRecognition()
    recognition.lang = "he-IL"
    recognition.continuous = true
    recognition.interimResults = true

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalTranscript = ""
      let interimTranscript = ""
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          finalTranscript += transcript
        } else {
          interimTranscript = transcript
        }
      }
      if (finalTranscript) {
        const separator = value ? " " : ""
        onChange?.(value + separator + finalTranscript)
      }
    }

    recognition.onerror = () => {
      stopRecording()
    }

    recognition.onend = () => {
      if (isRecording) {
        // auto-restart if still recording
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
    timerRef.current = setInterval(() => {
      setRecordingTime((t) => t + 1)
    }, 1000)
  }

  const stopRecording = () => {
    recognitionRef.current?.stop()
    recognitionRef.current = null
    setIsRecording(false)
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    setShowMicDialog(false)
  }

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, "0")}`
  }

  return (
    <div
      dir="rtl"
      className={cn(
        "flex flex-col gap-3 rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 pb-6",
        className
      )}
    >
      {/* Header */}
      <div className={cn(
        "flex items-center px-6 py-3 rounded-t-[20px]",
        active ? "bg-bg-surface-primary-default-80" : "bg-bg-surface"
      )}>
        <span className="text-p-bold text-text-primary-default">
          {title}
        </span>
      </div>

      {/* Subtitle */}
      <div className="px-6">
        <p className="text-small text-text-neutral-default">{subtitle}</p>
      </div>

      {/* Content area */}
      <div className="flex flex-col gap-6 px-6">
        <Textarea
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          onFocus={onFocus}
          className="min-h-[156px] rounded-[10px] border-border-neutral-default bg-white dark:bg-gray-10 resize-none shadow-none"
        />
        <div className="flex flex-col gap-2 items-end">
          <div className="flex gap-2">
            <Button variant="danger" className="gap-2" onClick={() => setShowMicDialog(true)} disabled={!active}>
              <Mic className="size-4" />
              {buttonLabel}
            </Button>
            <Button onClick={onSubmit} disabled={!active || !value?.trim()}>
              {submitLabel}
            </Button>
          </div>
          {warningText && active && (
            <p className="text-small text-red-50 text-start">{warningText}</p>
          )}
        </div>
      </div>

      {/* Mic Dialog */}
      <Dialog open={showMicDialog} onOpenChange={(open) => {
        if (!open && isRecording) stopRecording()
        setShowMicDialog(open)
      }}>
        <DialogContent dir="rtl" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>הקלטה קולית</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            {/* Device selector */}
            <div className="flex flex-col gap-2">
              <label className="text-small-bold text-text-primary-default">
                בחירת מיקרופון
              </label>
              <select
                value={selectedDeviceId}
                onChange={(e) => setSelectedDeviceId(e.target.value)}
                disabled={isRecording}
                className="h-10 rounded-lg border border-border-neutral-default bg-white dark:bg-gray-10 px-3 text-small text-text-primary-default"
              >
                {devices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `מיקרופון ${devices.indexOf(device) + 1}`}
                  </option>
                ))}
              </select>
            </div>

            {/* Recording controls */}
            <div className="flex flex-col items-center gap-4 py-4">
              {isRecording && (
                <div className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-p-bold text-text-primary-default font-mono">
                    {formatTime(recordingTime)}
                  </span>
                </div>
              )}

              <button
                onClick={isRecording ? stopRecording : startRecording}
                className={cn(
                  "size-16 rounded-full flex items-center justify-center transition-all",
                  isRecording
                    ? "bg-red-500 hover:bg-red-600 text-white"
                    : "bg-button-primary-default hover:bg-button-primary-hover text-white"
                )}
              >
                {isRecording ? (
                  <Square className="size-6" />
                ) : (
                  <Mic className="size-6" />
                )}
              </button>

              <p className="text-small text-text-neutral-default">
                {isRecording
                  ? "מקליט... לחצו לעצור"
                  : "לחצו להתחיל הקלטה"}
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
