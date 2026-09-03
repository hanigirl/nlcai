"use client"

import { useEffect, useState } from "react"
import { Loader2, Trash2, MessageSquare, Pencil } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"

interface LearnedInsight {
  id: string
  insight: string
  content_type: "hook" | "core_post"
  source: "manual_edit" | "chat_instruction" | null
  outcome: "accepted" | "rejected" | null
  instruction: string | null
  created_at: string
}

const CONTENT_TYPE_LABEL: Record<LearnedInsight["content_type"], string> = {
  core_post: "פוסט ליבה",
  hook: "הוק",
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getDate().toString().padStart(2, "0")}.${(d.getMonth() + 1).toString().padStart(2, "0")}.${d.getFullYear().toString().slice(2)}`
}

/**
 * Everything the AI has learned from the user's own corrections, with a way
 * to forget any single lesson. Until now the list was invisible: a wrong or
 * trivial insight (a comma, a blank line) sat in every generation prompt as
 * a binding rule, and nobody could see it, let alone remove it.
 */
export function LearnedInsightsPanel() {
  const [insights, setInsights] = useState<LearnedInsight[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/learning-log")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setInsights(data.insights ?? [])
      })
      .catch(() => {
        if (!cancelled) toast.error("לא הצלחנו לטעון את מה שה-AI למד")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleDelete = async (id: string) => {
    setDeleting(id)
    try {
      const res = await fetch(`/api/learning-log/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error(await res.text())
      setInsights((prev) => prev.filter((i) => i.id !== id))
      toast.success("ה-AI שכח את זה")
    } catch {
      toast.error("המחיקה נכשלה, נסו שוב")
    } finally {
      setDeleting(null)
    }
  }

  const preferences = insights.filter((i) => i.outcome !== "rejected")
  const rejections = insights.filter((i) => i.outcome === "rejected")

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-5 animate-spin text-text-neutral-default" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h3 className="text-p-bold text-text-primary-default">מה ה-AI למד עליכם</h3>
        <p className="text-small text-text-neutral-default">
          כל תיקון שאתם עושים לפוסט או להוק הופך לכלל שה-AI מקבל בכל כתיבה הבאה. אם כלל לא נכון או לא חשוב, מחקו אותו וה-AI יפסיק להתחשב בו.
        </p>
      </div>

      {insights.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border-neutral-default p-6 text-center">
          <p className="text-p text-text-neutral-default">
            עדיין אין כאן כלום. ערכו פוסט ליבה שה-AI כתב, וההעדפות שלכם יתחילו להצטבר כאן.
          </p>
        </div>
      ) : (
        <>
          <InsightGroup
            title="העדפות"
            hint="נלמדו מתיקונים שעשיתם ומשינויים שאישרתם"
            items={preferences}
            deleting={deleting}
            onDelete={handleDelete}
          />
          {rejections.length > 0 && (
            <InsightGroup
              title="מה לא עבד"
              hint="שינויים שה-AI הציע וביטלתם. ה-AI מקבל הוראה לא לחזור עליהם"
              items={rejections}
              deleting={deleting}
              onDelete={handleDelete}
            />
          )}
        </>
      )}
    </div>
  )
}

function InsightGroup({
  title,
  hint,
  items,
  deleting,
  onDelete,
}: {
  title: string
  hint: string
  items: LearnedInsight[]
  deleting: string | null
  onDelete: (id: string) => void
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <span className="text-p-bold text-text-primary-default">{title}</span>
        <span className="text-xs-body text-text-neutral-default">{items.length}</span>
      </div>
      <p className="text-xs-body text-text-neutral-default -mt-2">{hint}</p>
      {items.length === 0 ? (
        <p className="text-small text-text-neutral-default">אין עדיין.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-start gap-3 rounded-2xl border border-border-neutral-default bg-white dark:bg-gray-10 p-4"
            >
              <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                <p className="text-p text-text-primary-default leading-relaxed">{item.insight}</p>
                {item.instruction && (
                  <p className="text-xs-body text-text-neutral-default">
                    ביקשתם: &quot;{item.instruction}&quot;
                  </p>
                )}
                <div className="flex items-center gap-2 text-xs-body text-text-neutral-default">
                  <span>{CONTENT_TYPE_LABEL[item.content_type] ?? item.content_type}</span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1">
                    {item.source === "chat_instruction" ? (
                      <MessageSquare className="size-3" aria-hidden="true" />
                    ) : (
                      <Pencil className="size-3" aria-hidden="true" />
                    )}
                    {item.source === "chat_instruction" ? "מהצ'אט" : "מעריכה ידנית"}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{formatDate(item.created_at)}</span>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="מחיקה"
                disabled={deleting === item.id}
                onClick={() => onDelete(item.id)}
                className="shrink-0 text-text-neutral-default hover:text-button-destructive-default"
              >
                {deleting === item.id ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
