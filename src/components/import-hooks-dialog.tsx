"use client"

import { useRef, useState } from "react"
import { FileUp } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { parseGoogleDocId } from "@/lib/hook-import"

interface ImportHooksDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called once a valid source is chosen. The dialog closes itself first. */
  onImportFile: (file: File) => void
  onImportDocsUrl: (url: string) => void
}

const isWordFile = (file: File) => /\.docx?$/i.test(file.name)

/**
 * Where an import starts: a Google Docs link or a Word file from the computer.
 *
 * Only picks the source. Everything after (skeletons, highlight, toasts) is
 * the warehouse page's import flow, identical for both. Mistakes we can
 * catch before sending — a link that isn't a Docs link, a file that isn't
 * Word — are shown inline so the dialog stays open to fix them.
 */
export function ImportHooksDialog({ open, onOpenChange, onImportFile, onImportDocsUrl }: ImportHooksDialogProps) {
  const [url, setUrl] = useState("")
  const [urlError, setUrlError] = useState("")
  const [fileError, setFileError] = useState("")
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setUrl("")
    setUrlError("")
    setFileError("")
    setDragging(false)
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  const submitUrl = () => {
    if (!parseGoogleDocId(url)) {
      setUrlError("זה לא נראה כמו קישור ל-Google Docs. הקישור צריך להתחיל ב-docs.google.com/document")
      return
    }
    const value = url.trim()
    handleOpenChange(false)
    onImportDocsUrl(value)
  }

  const pickFile = (file: File | undefined) => {
    if (!file) return
    if (!isWordFile(file)) {
      setFileError("אפשר להעלות רק קובץ Word (doc או docx)")
      return
    }
    handleOpenChange(false)
    onImportFile(file)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent dir="rtl" className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader className="text-start">
          <DialogTitle>הוספת הוקים מקובץ</DialogTitle>
          <DialogDescription className="text-xs-body text-text-neutral-default">
            כל הוק בשורה נפרדת. ההוקים יתווספו למחסן.
          </DialogDescription>
        </DialogHeader>

        {/* Google Docs link */}
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            submitUrl()
          }}
        >
          <Label htmlFor="import-docs-url" className="text-small text-text-primary-default">
            קישור ל-Google Docs
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="import-docs-url"
              inputSize="small"
              dir="ltr"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                if (urlError) setUrlError("")
              }}
              placeholder="https://docs.google.com/document/d/…"
              aria-invalid={!!urlError}
              aria-describedby="import-docs-url-help"
              className="text-xs text-start"
            />
            <Button type="submit" size="sm" disabled={!url.trim()}>
              ייבוא
            </Button>
          </div>
          <p
            id="import-docs-url-help"
            className={`text-xs-body ${urlError ? "text-button-destructive-default" : "text-text-neutral-default"}`}
            role={urlError ? "alert" : undefined}
          >
            {urlError || "המסמך צריך להיות משותף עם ״כל מי שיש לו את הקישור״."}
          </p>
        </form>

        <div className="flex items-center gap-3 text-xs-body text-text-neutral-default">
          <span className="h-px flex-1 bg-border-neutral-default" />
          או
          <span className="h-px flex-1 bg-border-neutral-default" />
        </div>

        {/* Upload from computer: click or drop */}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              setFileError("")
              pickFile(e.dataTransfer.files?.[0])
            }}
            className={`flex flex-col items-center justify-center gap-1.5 rounded-[12px] border border-dashed px-4 py-6 text-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 ${
              dragging
                ? "border-yellow-50 bg-bg-surface-primary-default"
                : "border-gray-70 dark:border-gray-40 bg-white dark:bg-gray-10 hover:bg-gray-95 dark:hover:bg-gray-20"
            }`}
          >
            <FileUp className="size-5 text-text-neutral-default" />
            <span className="text-small text-text-primary-default">העלאת קובץ מהמחשב</span>
            <span className="text-xs-body text-text-neutral-default">גוררים לכאן או לוחצים לבחירה · doc או docx</span>
          </button>
          {fileError && (
            <p className="text-xs-body text-button-destructive-default" role="alert">
              {fileError}
            </p>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword"
            className="hidden"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0]
              // Reset so picking the same file again still fires onChange.
              e.target.value = ""
              setFileError("")
              pickFile(file)
            }}
          />
        </div>

        <DialogFooter className="flex flex-row gap-2 sm:justify-start">
          <Button type="button" size="sm" variant="outline" onClick={() => handleOpenChange(false)}>
            ביטול
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
