"use client"

import { useEffect, useRef, useState } from "react"
import { Paperclip, X, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Select } from "@/components/ui/select"
import { createClient } from "@/lib/supabase/client"

// The app's pages, matching the "עמוד" select options in the Notion DB.
export const PAGES = [
  "בית",
  "פוסטי ליבה",
  "רעיונות",
  "מחסן הוקים",
  "מדיה",
  "תזמון",
  "הגדרות",
  "אחר",
] as const

export type BugReportPage = (typeof PAGES)[number]

/** Maps a route to the "עמוד" option it belongs to, so the report
 *  opens with the current page already selected. */
export function pageForPathname(pathname: string | null): BugReportPage {
  if (!pathname || pathname === "/") return "בית"
  if (pathname.startsWith("/core_posts")) return "פוסטי ליבה"
  if (pathname.startsWith("/ideas") || pathname.startsWith("/project")) return "רעיונות"
  if (pathname.startsWith("/hooks")) return "מחסן הוקים"
  if (pathname.startsWith("/media")) return "מדיה"
  if (pathname.startsWith("/calendar")) return "תזמון"
  if (pathname.startsWith("/settings")) return "הגדרות"
  return "אחר"
}

const MEDIA_BUCKET = "user-media"
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024 // 10MB
const MAX_SCREENSHOTS = 5

interface BugReportModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The page the user is currently on, pre-selected in the dropdown. */
  defaultPage?: BugReportPage
}

export function BugReportModal({ open, onOpenChange, defaultPage = "בית" }: BugReportModalProps) {
  const [description, setDescription] = useState("")
  const [page, setPage] = useState<string>(defaultPage)
  const [files, setFiles] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setDescription("")
    setPage(defaultPage)
    setFiles([])
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const removeFile = (index: number) => setFiles((prev) => prev.filter((_, i) => i !== index))

  const close = () => {
    reset()
    onOpenChange(false)
  }

  // Close on Escape — popover behaviour, no backdrop.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? [])
    e.target.value = "" // clear so re-picking the same file still fires onChange
    if (picked.length === 0) return
    if (picked.some((f) => f.size > MAX_SCREENSHOT_BYTES)) {
      toast.error("צילום המסך גדול מדי (מקסימום 10MB)")
      return
    }
    setFiles((prev) => {
      const next = [...prev, ...picked]
      if (next.length > MAX_SCREENSHOTS) {
        toast.error(`אפשר לצרף עד ${MAX_SCREENSHOTS} צילומים`)
        return next.slice(0, MAX_SCREENSHOTS)
      }
      return next
    })
  }

  const handleSubmit = async () => {
    if (submitting) return
    if (!description.trim()) {
      toast.error("נא לכתוב תיאור של הבאג")
      return
    }
    setSubmitting(true)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        toast.error("צריך להיות מחובר כדי לדווח")
        return
      }

      // Upload each screenshot to the existing user-media bucket and keep the
      // public URLs — Notion stores the links, not the binaries.
      const screenshotUrls: string[] = []
      for (const f of files) {
        const ext = f.name.split(".").pop() || "png"
        const path = `${user.id}/bug-reports/${crypto.randomUUID()}.${ext}`
        const { error: uploadError } = await supabase.storage
          .from(MEDIA_BUCKET)
          .upload(path, f, { contentType: f.type || undefined })
        if (uploadError) {
          console.error("[bug-report] screenshot upload failed:", uploadError)
          toast.error("העלאת אחד הצילומים נכשלה — ממשיכים בלעדיו")
        } else {
          screenshotUrls.push(supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl)
        }
      }

      const res = await fetch("/api/bug-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: description.trim(),
          page: PAGES.includes(page as (typeof PAGES)[number]) ? page : "אחר",
          screenshotUrls,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        if (data.error === "notion_not_configured") {
          toast.error("הדיווח לא נשלח — חיבור ה-Notion עדיין לא הוגדר")
        } else {
          toast.error("שליחת הדיווח נכשלה, נסי שוב")
        }
        return
      }

      toast.success("תודה! הדיווח נשלח 🙏")
      close()
    } catch (err) {
      console.error("[bug-report] submit failed:", err)
      toast.error("משהו השתבש, נסי שוב")
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <>
      {/* Transparent click-catcher — closes on outside click WITHOUT dimming
          the page. No dark overlay. */}
      <div className="fixed inset-0 z-40" aria-hidden onClick={close} />

      {/* Floating popover, anchored just above the trigger button (bottom-right,
          left of the right-pinned sidebar on desktop). */}
      <div
        dir="rtl"
        role="dialog"
        aria-modal="false"
        aria-label="דיווח על באג"
        className="fixed bottom-20 right-6 z-50 flex max-h-[calc(100vh-7rem)] w-[calc(100vw-3rem)] max-w-[358px] flex-col gap-6 overflow-y-auto rounded-2xl bg-white p-6 shadow-[0px_12px_24px_rgba(0,0,0,0.18)] origin-bottom-left animate-in fade-in zoom-in-95 duration-150 md:right-[4.5rem]"
      >
        {/* Header — title on the right, close button on the left (RTL) */}
        <div className="flex w-full items-center justify-between">
          <h2 className="text-lg font-bold text-text-primary-default">נתקלת בבאג?</h2>
          <button
            type="button"
            onClick={close}
            aria-label="סגור"
            className="flex size-8 items-center justify-center rounded-2xl border border-border-neutral-default text-text-primary-default transition-colors hover:bg-gray-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex w-full flex-col gap-5">
          {/* Description */}
          <div className="flex w-full flex-col gap-2">
            <label htmlFor="bug-description" className="w-full text-right text-sm font-semibold text-text-primary-default">
              תיאור הבאג
            </label>
            <div className="flex min-h-[120px] w-full flex-col gap-2 rounded-lg border border-border-neutral-default bg-bg-surface p-3">
              <textarea
                id="bug-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="תארו את התקלה כאן, מה קרה ומה היית מצפה שיקרה..."
                className="min-h-0 flex-1 resize-none border-0 bg-transparent text-right text-base outline-none placeholder:text-text-neutral-default md:text-sm"
              />
              <div className="flex flex-wrap items-center justify-start gap-1.5">
                {/* Attached screenshots — tiny chips, each removable */}
                {files.map((f, i) => (
                  <span
                    key={`${f.name}-${i}`}
                    className="flex max-w-[110px] items-center gap-1 rounded-md bg-gray-95 px-1.5 py-0.5 text-[10px] text-text-neutral-default"
                  >
                    <span className="truncate">{f.name}</span>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      aria-label={`הסר ${f.name}`}
                      className="shrink-0 transition-colors hover:text-text-primary-default"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
                {/* Always visible — add another screenshot */}
                {files.length < MAX_SCREENSHOTS && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1.5 rounded-md text-xs text-text-neutral-default transition-colors hover:text-text-primary-default"
                  >
                    <span>הוספת צילום מסך</span>
                    <Paperclip className="size-4" />
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleFilePick}
                />
              </div>
            </div>
          </div>

          {/* Page */}
          <div className="flex w-full flex-col gap-2">
            <label htmlFor="bug-page" className="w-full text-right text-sm font-semibold text-text-primary-default">
              נמצא בעמוד
            </label>
            <Select
              id="bug-page"
              value={page}
              onChange={(e) => setPage(e.target.value)}
              className="text-right"
            >
              {PAGES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </Select>
          </div>
        </div>

        {/* Footer — primary action on the right (RTL) */}
        <div className="flex w-full justify-start">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="flex items-center justify-center gap-2 rounded-lg bg-button-primary-default px-10 py-3 text-base font-semibold text-white transition hover:brightness-90 disabled:opacity-60"
          >
            {submitting && <Loader2 className="size-4 animate-spin" />}
            שלח
          </button>
        </div>
      </div>
    </>
  )
}
