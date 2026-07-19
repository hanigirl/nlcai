"use client"

import { useEffect, useRef, useState } from "react"
import { Plus, Trash2, Loader2, Link2, FileText, Upload, AlertCircle } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { createClient } from "@/lib/supabase/client"
import type { BusinessSource, BusinessSourceType } from "@/lib/supabase/types"

// How many active sources the AI actually reads per generation (matches the
// cap in src/lib/business-source-insights.ts). Surfaced so the limit is never
// silent — the user curates via the "פעיל" toggle when they have many.
const ACTIVE_LIMIT = 6

const TYPE_LABEL: Record<BusinessSourceType, string> = {
  meeting: "פגישה",
  webinar: "וובינר",
  doc: "מסמך",
  link: "קישור",
  other: "אחר",
}

const TYPE_OPTIONS: BusinessSourceType[] = ["meeting", "webinar", "doc", "link", "other"]

const ADD_ERROR: Record<string, string> = {
  invalid_drive_link: "לא זוהה קובץ בקישור.",
  scrape_failed: "לא הצלחנו לקרוא את הקישור. ודאו שהוא ציבורי ונסו שוב.",
  file_unreadable: "לא הצלחנו לקרוא את הקובץ. תומכים ב-pdf, docx, doc, txt, md.",
  file_too_large: "הקובץ גדול מדי (מקסימום 10MB).",
  url_required: "צריך להזין קישור.",
  file_required: "צריך לבחור קובץ.",
}

function StatusDot({ status }: { status: BusinessSource["status"] }) {
  const map = {
    ready: { color: "bg-yellow-50", label: "מסוכם" },
    pending: { color: "bg-gray-70", label: "בעיבוד" },
    failed: { color: "bg-button-destructive-default", label: "נכשל" },
  }[status]
  return (
    <span className="inline-flex items-center gap-1 text-xs text-text-neutral-default">
      <span className={`size-1.5 rounded-full ${map.color}`} aria-hidden />
      {map.label}
    </span>
  )
}

export function BusinessSourcesPanel() {
  const [sources, setSources] = useState<BusinessSource[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)

  // Add-source form
  const [type, setType] = useState<BusinessSourceType>("meeting")
  const [mode, setMode] = useState<"link" | "file">("link")
  const [url, setUrl] = useState("")
  const [title, setTitle] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from("business_sources")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) console.error("[business-sources] load", error)
        else setSources((data as BusinessSource[]) ?? [])
        setLoading(false)
      })
  }, [])

  const resetForm = () => {
    setType("meeting")
    setMode("link")
    setUrl("")
    setTitle("")
    setFile(null)
    setAddError(null)
  }

  const handleAdd = async () => {
    setAddError(null)
    if (mode === "link" && !url.trim()) {
      setAddError(ADD_ERROR.url_required)
      return
    }
    if (mode === "file" && !file) {
      setAddError(ADD_ERROR.file_required)
      return
    }
    setAdding(true)
    try {
      let res: Response
      if (mode === "file" && file) {
        const fd = new FormData()
        fd.append("file", file)
        fd.append("type", type)
        if (title.trim()) fd.append("title", title.trim())
        res = await fetch("/api/business-sources", { method: "POST", body: fd })
      } else {
        res = await fetch("/api/business-sources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, url: url.trim(), title: title.trim() || undefined }),
        })
      }
      const data = await res.json()
      if (!res.ok || data.error) {
        setAddError(ADD_ERROR[data.error] ?? data.message ?? "ההוספה נכשלה. נסו שוב.")
        return
      }
      if (data.source) setSources((prev) => [data.source as BusinessSource, ...prev])
      if (data.warning) toast.message("המקור נשמר, אבל הסיכום לא הושלם", { description: data.warning })
      else toast.success("המקור נוסף")
      setDialogOpen(false)
      resetForm()
    } catch (err) {
      console.error("[business-sources] add", err)
      setAddError("שגיאת רשת. נסו שוב.")
    } finally {
      setAdding(false)
    }
  }

  const toggleActive = async (src: BusinessSource) => {
    const next = !src.active
    setSources((prev) => prev.map((s) => (s.id === src.id ? { ...s, active: next } : s)))
    try {
      const res = await fetch("/api/business-sources", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: src.id, active: next }),
      })
      if (!res.ok) throw new Error(`status ${res.status}`)
    } catch (err) {
      console.error("[business-sources] toggle", err)
      setSources((prev) => prev.map((s) => (s.id === src.id ? { ...s, active: src.active } : s)))
      toast.error("העדכון נכשל")
    }
  }

  const remove = async (src: BusinessSource) => {
    const prev = sources
    setSources((p) => p.filter((s) => s.id !== src.id))
    try {
      const res = await fetch(`/api/business-sources?id=${src.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error(`status ${res.status}`)
    } catch (err) {
      console.error("[business-sources] delete", err)
      setSources(prev)
      toast.error("המחיקה נכשלה")
    }
  }

  const activeCount = sources.filter((s) => s.active && s.status === "ready").length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-small text-text-neutral-default leading-relaxed">
          רשות. הוסיפו פגישות, וובינרים ומסמכים כדי שה-AI יכיר את העסק שלכם לעומק ויכתוב הוקים ותכנים מדויקים יותר.
        </p>
        <p className="text-xs text-text-primary-disabled">
          ה-AI משתמש עד {ACTIVE_LIMIT} המקורות הפעילים האחרונים. סמנו „פעיל” כדי לבחור אילו מהם יוזנו.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-small text-text-neutral-default">
          <Loader2 className="size-4 animate-spin" /> טוען מקורות...
        </div>
      ) : sources.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl bg-bg-surface py-8 text-center">
          <FileText className="size-7 text-text-neutral-default" aria-hidden />
          <p className="text-small text-text-neutral-default">עדיין לא הוספתם מקורות</p>
          <p className="text-xs text-text-primary-disabled">זה אופציונלי לגמרי — אפשר להתחיל מתי שבא לכם.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {sources.map((src) => (
            <div
              key={src.id}
              className="group flex flex-col gap-2 rounded-2xl bg-bg-surface px-3 py-3"
            >
              <div className="flex items-center gap-2">
                {src.source_url ? (
                  <Link2 className="size-4 shrink-0 text-text-neutral-default" aria-hidden />
                ) : (
                  <FileText className="size-4 shrink-0 text-text-neutral-default" aria-hidden />
                )}
                <span className="flex-1 truncate text-small-bold text-text-primary-default" title={src.title}>
                  {src.title}
                </span>
                <span className="shrink-0 rounded-full bg-white dark:bg-gray-10 px-2 py-0.5 text-xs text-text-neutral-default">
                  {TYPE_LABEL[src.source_type]}
                </span>
                <StatusDot status={src.status} />
                <button
                  type="button"
                  onClick={() => remove(src)}
                  aria-label="מחיקה"
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1"
                >
                  <Trash2 className="size-4 text-text-neutral-default hover:text-button-destructive-default" />
                </button>
              </div>

              {src.summary && (
                <p dir="auto" className="line-clamp-2 text-xs text-text-neutral-default text-start">
                  {src.summary}
                </p>
              )}
              {src.status === "failed" && (
                <p className="flex items-center gap-1 text-xs text-button-destructive-default">
                  <AlertCircle className="size-3.5" /> הסיכום נכשל — נסו למחוק ולהוסיף שוב.
                </p>
              )}

              <label className="flex w-fit items-center gap-2 px-1 cursor-pointer select-none">
                <Checkbox checked={src.active} onCheckedChange={() => toggleActive(src)} />
                <span className="text-xs text-text-neutral-default">פעיל — הזינו ל-AI</span>
              </label>
            </div>
          ))}
          <p className="px-1 text-xs text-text-primary-disabled">
            {activeCount} מקורות פעילים · ה-AI ישתמש ב-{Math.min(activeCount, ACTIVE_LIMIT)} האחרונים.
          </p>
        </div>
      )}

      <Button
        variant="outline"
        onClick={() => { resetForm(); setDialogOpen(true) }}
        className="w-full h-12 rounded-2xl border-border-neutral-default text-text-neutral-default gap-2"
      >
        <Plus className="size-4" />
        הוספת מקור
      </Button>

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!adding) { setDialogOpen(o); if (!o) resetForm() } }}>
        <DialogContent dir="rtl" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>הוספת מקור ידע</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-small text-text-neutral-default">סוג המקור</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as BusinessSourceType)}
                className="h-10 rounded-xl border border-border-neutral-default bg-white dark:bg-gray-10 px-3 text-small text-text-primary-default appearance-none cursor-pointer pe-8"
                style={{
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23808080' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "left 0.5rem center",
                }}
              >
                {TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>{TYPE_LABEL[t]}</option>
                ))}
              </select>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMode("link")}
                className={`flex-1 h-9 rounded-lg text-small transition-colors ${mode === "link" ? "bg-bg-surface-primary-default text-text-primary-default" : "bg-bg-surface text-text-neutral-default hover:bg-bg-surface-hover"}`}
              >
                <Link2 className="inline size-3.5 me-1" /> קישור
              </button>
              <button
                type="button"
                onClick={() => setMode("file")}
                className={`flex-1 h-9 rounded-lg text-small transition-colors ${mode === "file" ? "bg-bg-surface-primary-default text-text-primary-default" : "bg-bg-surface text-text-neutral-default hover:bg-bg-surface-hover"}`}
              >
                <Upload className="inline size-3.5 me-1" /> העלאת קובץ
              </button>
            </div>

            {mode === "link" ? (
              <Input
                dir="ltr"
                value={url}
                onChange={(e) => { setUrl(e.target.value); setAddError(null) }}
                placeholder="https://docs.google.com/... או קישור למאמר"
                className="text-xs"
              />
            ) : (
              <div className="flex flex-col gap-1.5">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.doc,.txt,.md"
                  onChange={(e) => { setFile(e.target.files?.[0] ?? null); setAddError(null) }}
                  className="hidden"
                />
                <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="gap-2">
                  <Upload className="size-4" />
                  {file ? file.name : "בחרו קובץ (pdf, docx, txt, md)"}
                </Button>
              </div>
            )}

            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="כותרת (רשות)"
              className="text-small"
            />

            {addError && <p className="text-xs text-button-destructive-default">{addError}</p>}
          </div>

          <DialogFooter className="flex flex-row-reverse gap-2 sm:justify-start">
            <Button onClick={handleAdd} disabled={adding} className="gap-1.5">
              {adding && <Loader2 className="size-4 animate-spin" />}
              {adding ? "מעבד..." : "הוספה"}
            </Button>
            <Button variant="outline" onClick={() => { setDialogOpen(false); resetForm() }} disabled={adding}>
              ביטול
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
