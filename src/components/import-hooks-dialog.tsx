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
  /** Called for tabular files (xlsx/csv) when a column has been chosen. */
  onImportTable?: (file: File, columnIndex: number) => void
}

const isWordFile = (file: File) => /\.docx?$/i.test(file.name)
const isTableFile = (file: File) => /\.(xlsx|csv)$/i.test(file.name)
const isMarkdownFile = (file: File) => /\.md$/i.test(file.name)
const isSupportedFile = (file: File) => isWordFile(file) || isTableFile(file) || isMarkdownFile(file)

/**
 * Where an import starts: a Google Docs link or a Word file from the computer.
 *
 * Only picks the source. Everything after (skeletons, highlight, toasts) is
 * the warehouse page's import flow, identical for both. Mistakes we can
 * catch before sending — a link that isn't a Docs link, a file that isn't
 * Word — are shown inline so the dialog stays open to fix them.
 */
export function ImportHooksDialog({ open, onOpenChange, onImportFile, onImportDocsUrl, onImportTable }: ImportHooksDialogProps) {
  const [url, setUrl] = useState("")
  const [urlError, setUrlError] = useState("")
  const [fileError, setFileError] = useState("")
  const [dragging, setDragging] = useState(false)

  // Column selection state for tabular files
  const [pendingTableFile, setPendingTableFile] = useState<File | null>(null)
  const [columns, setColumns] = useState<string[]>([])
  const [selectedColumn, setSelectedColumn] = useState<number>(0)
  const [columnLoading, setColumnLoading] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setUrl("")
    setUrlError("")
    setFileError("")
    setDragging(false)
    setPendingTableFile(null)
    setColumns([])
    setSelectedColumn(0)
    setColumnLoading(false)
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

  const submitTableWithColumn = () => {
    if (!pendingTableFile) return
    handleOpenChange(false)
    if (onImportTable) {
      onImportTable(pendingTableFile, selectedColumn)
    } else {
      onImportFile(pendingTableFile)
    }
  }

  const pickFile = async (file: File | undefined) => {
    if (!file) return
    if (!isSupportedFile(file)) {
      setFileError("אפשר להעלות קובץ Word, Excel, CSV או Markdown")
      return
    }
    setFileError("")

    if (isMarkdownFile(file) || isWordFile(file)) {
      handleOpenChange(false)
      onImportFile(file)
      return
    }

    // Tabular file: POST to get columns
    setColumnLoading(true)
    setPendingTableFile(file)
    setColumns([])
    setSelectedColumn(0)

    try {
      const formData = new FormData()
      formData.append("file", file)

      const res = await fetch("/api/hooks/import", {
        method: "POST",
        body: formData,
      })

      if (!res.ok) {
        setFileError("שגיאה בקריאת הקובץ. אנא נסה שנית.")
        setPendingTableFile(null)
        setColumnLoading(false)
        return
      }

      const data = await res.json()

      if (data.needsColumnSelection && Array.isArray(data.columns) && data.columns.length > 0) {
        setColumns(data.columns)
        setSelectedColumn(0)
      } else {
        // No column selection needed — treat as direct import
        handleOpenChange(false)
        if (onImportTable) {
          onImportTable(file, 0)
        } else {
          onImportFile(file)
        }
      }
    } catch {
      setFileError("שגיאה בקריאת הקובץ. אנא נסה שנית.")
      setPendingTableFile(null)
    } finally {
      setColumnLoading(false)
    }
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
              setPendingTableFile(null)
              setColumns([])
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
            <span className="text-xs-body text-text-neutral-default">גוררים לכאן או לוחצים לבחירה · doc, docx, xlsx, csv או md</span>
          </button>
          {fileError && (
            <p className="text-xs-body text-button-destructive-default" role="alert">
              {fileError}
            </p>
          )}

          {/* Column picker — shown only for tabular files */}
          {columnLoading && (
            <p className="text-xs-body text-text-neutral-default" role="status">
              קורא את הקובץ…
            </p>
          )}
          {!columnLoading && columns.length > 0 && pendingTableFile && (
            <div className="flex flex-col gap-2 rounded-[10px] border border-border-neutral-default bg-bg-surface-secondary-default p-3">
              <Label htmlFor="import-column-select" className="text-small text-text-primary-default">
                איזו עמודה מכילה את ההוקים?
              </Label>
              {/* TODO: Replace with Select component from '@/components/ui/select' when available */}
              <select
                id="import-column-select"
                value={selectedColumn}
                onChange={(e) => setSelectedColumn(Number(e.target.value))}
                className="w-full rounded-md border border-border-neutral-default bg-white dark:bg-gray-10 px-3 py-1.5 text-small text-text-primary-default focus:outline-none focus:ring-2 focus:ring-yellow-50"
                dir="rtl"
              >
                {columns.map((col, idx) => (
                  <option key={idx} value={idx}>
                    {col || `עמודה ${idx + 1}`}
                  </option>
                ))}
              </select>
              <Button type="button" size="sm" onClick={submitTableWithColumn}>
                ייבוא
              </Button>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".docx,.doc,.xlsx,.csv,.md,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/markdown"
            className="hidden"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0]
              // Reset so picking the same file again still fires onChange.
              e.target.value = ""
              setFileError("")
              setPendingTableFile(null)
              setColumns([])
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