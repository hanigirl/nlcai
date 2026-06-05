"use client"

import { useEffect, useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Loader2, Trash2, Plus, Download, Search } from "lucide-react"

type AllowedEmail = {
  email: string
  note: string | null
  created_at: string
}

type Notice = { text: string; type: "error" | "success" }

export default function AdminAllowlistPage() {
  const [emails, setEmails] = useState<AllowedEmail[]>([])
  const [protectedEmails, setProtectedEmails] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [input, setInput] = useState("")
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [sheetUrl, setSheetUrl] = useState("")
  const [importing, setImporting] = useState(false)
  const [query, setQuery] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/allowlist")
      if (res.status === 403) {
        setForbidden(true)
        return
      }
      const data = await res.json()
      if (!res.ok) {
        setNotice({ text: data.error ?? `שגיאה ${res.status}`, type: "error" })
        return
      }
      setEmails(data.emails ?? [])
      setProtectedEmails((data.protected ?? []).map((e: string) => e.toLowerCase()))
    } catch (e) {
      setNotice({ text: e instanceof Error ? e.message : String(e), type: "error" })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const add = async () => {
    if (!input.trim()) return
    setAdding(true)
    setNotice(null)
    try {
      const res = await fetch("/api/admin/allowlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: input }),
      })
      const data = await res.json()
      if (!res.ok) {
        setNotice({ text: data.error ?? `שגיאה ${res.status}`, type: "error" })
        return
      }
      const invalidNote =
        data.invalid?.length > 0
          ? ` (${data.invalid.length} כתובות לא תקינות דולגו)`
          : ""
      setNotice({
        text: `נוספו ${data.added} כתובות לרשימה${invalidNote}.`,
        type: "success",
      })
      setInput("")
      await load()
    } catch (e) {
      setNotice({ text: e instanceof Error ? e.message : String(e), type: "error" })
    } finally {
      setAdding(false)
    }
  }

  const importSheet = async () => {
    if (!sheetUrl.trim()) return
    setImporting(true)
    setNotice(null)
    try {
      const res = await fetch("/api/admin/allowlist", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheetUrl }),
      })
      const data = await res.json()
      if (!res.ok) {
        setNotice({ text: data.error ?? `שגיאה ${res.status}`, type: "error" })
        return
      }
      const dupNote =
        data.alreadyPresent > 0
          ? ` (${data.alreadyPresent} כבר היו ברשימה)`
          : ""
      setNotice({
        text: `נמצאו ${data.found} כתובות בגיליון — נוספו ${data.added}${dupNote}.`,
        type: "success",
      })
      setSheetUrl("")
      await load()
    } catch (e) {
      setNotice({ text: e instanceof Error ? e.message : String(e), type: "error" })
    } finally {
      setImporting(false)
    }
  }

  const remove = async (email: string) => {
    setRemoving(email)
    setNotice(null)
    try {
      const res = await fetch("/api/admin/allowlist", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!res.ok) {
        setNotice({ text: data.error ?? `שגיאה ${res.status}`, type: "error" })
        return
      }
      setEmails((prev) => prev.filter((e) => e.email !== email))
    } catch (e) {
      setNotice({ text: e instanceof Error ? e.message : String(e), type: "error" })
    } finally {
      setRemoving(null)
    }
  }

  if (forbidden) {
    return (
      <div dir="rtl" className="mx-auto max-w-2xl p-8">
        <p className="text-text-primary-default">
          אין לך הרשאה לעמוד הזה. הוא פתוח לבעלים בלבד.
        </p>
      </div>
    )
  }

  const q = query.trim().toLowerCase()
  const filtered = q
    ? emails.filter((e) => e.email.toLowerCase().includes(q))
    : emails

  return (
    <div dir="rtl" className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <div>
        <h1 className="text-xl-bold text-text-primary-default">
          רשימת מורשים להרשמה
        </h1>
        <p className="mt-1 text-small text-text-neutral-default">
          רק כתובות מייל שמופיעות כאן יכולות להירשם למערכת. הדביקו כתובות
          (אפשר ישר מעמודה בגיליון) — כל שורה, פסיק או רווח מפריד בין כתובות.
        </p>
      </div>

      {/* Add box */}
      <Card className="border-border-neutral-default rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-text-primary-default">
            הוספת כתובות
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Textarea
            dir="ltr"
            rows={4}
            placeholder={"student1@example.com\nstudent2@example.com"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="text-left"
          />
          <Button
            onClick={add}
            disabled={adding || !input.trim()}
            className="w-fit"
          >
            {adding ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            הוספה לרשימה
          </Button>
        </CardContent>
      </Card>

      {/* Import from Google Sheet */}
      <Card className="border-border-neutral-default rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-text-primary-default">
            ייבוא מ-Google Sheet
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-small text-text-neutral-default">
            הדביקו קישור לגיליון (משותף כ"כל מי שיש לו הקישור — צפייה"). נמשוך
            ממנו את כל כתובות המייל ונוסיף את החדשות. שמות וטלפונים לא נשמרים.
          </p>
          <div className="flex gap-2">
            <Input
              dir="ltr"
              placeholder="https://docs.google.com/spreadsheets/d/..."
              value={sheetUrl}
              onChange={(e) => setSheetUrl(e.target.value)}
              className="text-left"
            />
            <Button
              onClick={importSheet}
              disabled={importing || !sheetUrl.trim()}
              className="shrink-0"
            >
              {importing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
              ייבוא
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Notice */}
      {notice && (
        <div
          className={`rounded-xl px-4 py-3 text-center text-sm ${
            notice.type === "error"
              ? "bg-red-95 text-button-destructive-default"
              : "bg-bg-surface-primary-default text-text-primary-default"
          }`}
        >
          {notice.text}
        </div>
      )}

      {/* List */}
      <Card className="border-border-neutral-default rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-base text-text-primary-default">
            <span>הרשימה הנוכחית</span>
            {!loading && (
              <span className="text-small text-text-neutral-default">
                {q ? `${filtered.length} מתוך ${emails.length}` : `${emails.length} כתובות`}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="size-5 animate-spin text-text-neutral-default" />
            </div>
          ) : emails.length === 0 ? (
            <p className="py-6 text-center text-small text-text-neutral-default">
              הרשימה ריקה. הוסיפו כתובות למעלה.
            </p>
          ) : (
            <>
              {/* Search */}
              <div className="relative mb-3">
                <Search className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-text-neutral-default" />
                <Input
                  dir="rtl"
                  placeholder="חיפוש כתובת מייל..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pe-9"
                />
              </div>

              {filtered.length === 0 ? (
                <p className="py-6 text-center text-small text-text-neutral-default">
                  לא נמצאו תוצאות עבור &quot;{query}&quot;.
                </p>
              ) : (
                <ul className="flex flex-col divide-y divide-border-neutral-default">
                  {filtered.map((e) => {
                const isProtected = protectedEmails.includes(e.email)
                return (
                  <li
                    key={e.email}
                    className="flex items-center justify-between gap-3 py-2.5"
                  >
                    <span
                      dir="ltr"
                      className="truncate text-left text-small text-text-primary-default"
                    >
                      {e.email}
                    </span>
                    {isProtected ? (
                      <Badge variant="secondary">בעלים</Badge>
                    ) : (
                      <button
                        type="button"
                        onClick={() => remove(e.email)}
                        disabled={removing === e.email}
                        aria-label={`הסרת ${e.email}`}
                        className="text-text-neutral-default hover:text-button-destructive-default disabled:opacity-50"
                      >
                        {removing === e.email ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Trash2 className="size-4" />
                        )}
                      </button>
                    )}
                  </li>
                )
                  })}
                </ul>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
