"use client"

import { useState, useRef } from "react"
import { Upload, FileText, Loader2, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface FileUploadCardProps {
  type: "core" | "audience"
  title: string
  description: string
  onComplete?: () => void
}

export function FileUploadCard({
  type,
  title,
  description,
  onComplete,
}: FileUploadCardProps) {
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle")
  const [fileName, setFileName] = useState("")
  const [errorMsg, setErrorMsg] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File) => {
    setFileName(file.name)
    setStatus("uploading")
    setErrorMsg("")

    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("type", type)

      const res = await fetch("/api/parse-identity", {
        method: "POST",
        body: formData,
      })

      const data = await res.json()

      if (data.error) {
        setStatus("error")
        setErrorMsg(data.error)
        return
      }

      setStatus("done")
      onComplete?.()
    } catch {
      setStatus("error")
      setErrorMsg("שגיאה בעיבוד הקובץ")
    }
  }

  return (
    <Card
      dir="rtl"
      className="border-border-neutral-default bg-white dark:bg-gray-10 gap-0"
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-text-primary-default">{title}</CardTitle>
        <p className="text-small text-text-neutral-default mt-1">{description}</p>
      </CardHeader>

      <CardContent>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,.doc,.txt,.md,.rtf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleFile(file)
          }}
        />

        {status === "idle" && (
          <button
            onClick={() => inputRef.current?.click()}
            className="w-full flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-border-neutral-default hover:border-yellow-50 p-8 transition-colors cursor-pointer"
          >
            <Upload className="size-8 text-text-neutral-default" />
            <span className="text-small text-text-neutral-default">
              גרור קובץ לכאן או לחץ לבחירה
            </span>
            <span className="text-xs-body text-text-neutral-default">
              pdf, docx, doc, txt, md
            </span>
          </button>
        )}

        {status === "uploading" && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border-neutral-default p-8">
            <Loader2 className="size-8 animate-spin text-yellow-50" />
            <div className="flex items-center gap-2">
              <FileText className="size-4 text-text-neutral-default" />
              <span className="text-small text-text-neutral-default">{fileName}</span>
            </div>
            <span className="text-small text-text-neutral-default">
              הסוכן מעבד את הקובץ...
            </span>
          </div>
        )}

        {status === "done" && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-green-500/30 bg-green-50 dark:bg-green-950/20 p-8">
            <Check className="size-8 text-green-600 dark:text-green-400" />
            <span className="text-small text-green-700 dark:text-green-400">
              הקובץ עובד בהצלחה!
            </span>
            <Button
              variant="ghost"
              onClick={() => {
                setStatus("idle")
                setFileName("")
              }}
              className="text-text-neutral-default"
            >
              העלאת קובץ אחר
            </Button>
          </div>
        )}

        {status === "error" && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-red-500/30 bg-red-50 dark:bg-red-950/20 p-8">
            <span className="text-small text-red-600 dark:text-red-400">
              {errorMsg}
            </span>
            <Button
              variant="ghost"
              onClick={() => {
                setStatus("idle")
                setFileName("")
              }}
            >
              נסה שוב
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
