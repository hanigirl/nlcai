"use client"

import { useEffect, useState } from "react"
import { useQaFixes1112 } from "@/lib/use-scheduling-access"
import { brandTerms } from "@/lib/brand-terms"
import Link from "next/link"
import { Loader2, Pencil, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TalkingHeadTemplateSettings } from "@/components/talking-head-ai"
import { useTalkingHeadAi } from "@/lib/use-scheduling-access"
import {
  RULE_SCOPES,
  VISUAL_SETTINGS_HREF,
  deletePreference,
  updatePreference,
  type RuleScope,
  type VisualPreference,
} from "@/lib/visual-memory"
import { OWN_CAPTION_LOOK_ID } from "@/lib/own-caption-look"
import type { CaptionStyle } from "@/lib/own-media"

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return `${d.getDate().toString().padStart(2, "0")}.${(d.getMonth() + 1).toString().padStart(2, "0")}.${d.getFullYear().toString().slice(2)}`
}

/**
 * Settings → מדיה → העדפות ויזואליות (Hani, 2026-11-05).
 *
 * Everything the AI-edit chat saved to her visual memory — how things move,
 * enter and change, layout habits, decorations it draws — split by format
 * like דוגמאות לשימוש, plus "כל הפורמטים". She can edit or delete any of them
 * at any time; the next generation of that format reads the list as it is.
 * Colours, fonts and brand elements are not here: they live in שפה ויזואלית.
 */
export function VisualPreferencesPanel() {
  const qaTerms = useQaFixes1112() === true
  const bt = (t: string) => brandTerms(t, qaTerms)
  const [prefs, setPrefs] = useState<VisualPreference[]>([])
  // The caption look saved with "זכור לעתיד" on her own media — its own file,
  // shown here under "כל הפורמטים" so it isn't invisible (Notion #7).
  const [ownLook, setOwnLook] = useState<CaptionStyle | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tab, setTab] = useState<RuleScope | "talking_head">("all")
  // "דיבור למצלמה" — her talking-head template (Hani + Nataliya, 2026-11-07).
  const talkingHead = useTalkingHeadAi() === true
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [busy, setBusy] = useState<{ id: string; what: "save" | "delete" } | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/visual-language/style-memory")
      .then(async (r) => {
        const data = (await r.json().catch(() => ({}))) as {
          preferences?: VisualPreference[]
          ownCaptionLook?: CaptionStyle | null
          message?: string
        }
        if (!r.ok) throw new Error(data.message ?? `status ${r.status}`)
        return { list: data.preferences ?? [], look: data.ownCaptionLook ?? null }
      })
      .then(({ list, look }) => {
        if (cancelled) return
        setPrefs(list)
        setOwnLook(look)
        // Open on the first format that has something, so she sees her list.
        const first = look ? RULE_SCOPES[0] : RULE_SCOPES.find((s) => list.some((p) => p.scope === s.id))
        if (first) setTab(first.id)
      })
      .catch((err) => {
        console.error("[visual-preferences] load", err)
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // The chat saves on the server while this tab stays open — read the list
  // again whenever she comes back to it (Hani, 2026-11-10: "לא שמר").
  useEffect(() => {
    const reload = () => {
      if (document.visibilityState !== "visible") return
      fetch("/api/visual-language/style-memory", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { preferences?: VisualPreference[]; ownCaptionLook?: CaptionStyle | null } | null) => {
          if (data?.preferences) setPrefs(data.preferences)
          if (data) setOwnLook(data.ownCaptionLook ?? null)
        })
        .catch(() => undefined)
    }
    window.addEventListener("focus", reload)
    document.addEventListener("visibilitychange", reload)
    return () => {
      window.removeEventListener("focus", reload)
      document.removeEventListener("visibilitychange", reload)
    }
  }, [])

  const save = async () => {
    if (!editing) return
    const text = editing.text.trim()
    if (!text) return
    setBusy({ id: editing.id, what: "save" })
    try {
      const { preference } = await updatePreference(editing.id, text)
      setPrefs((prev) => prev.map((p) => (p.id === preference.id ? preference : p)))
      setEditing(null)
      toast.success("ההעדפה עודכנה")
    } catch (err) {
      console.error("[visual-preferences] update", err)
      toast.error(err instanceof Error ? err.message : "העדכון נכשל, נסו שוב")
    } finally {
      setBusy(null)
    }
  }

  const remove = async (id: string) => {
    setBusy({ id, what: "delete" })
    try {
      await deletePreference(id)
      if (id === OWN_CAPTION_LOOK_ID) setOwnLook(null)
      else setPrefs((prev) => prev.filter((p) => p.id !== id))
      if (editing?.id === id) setEditing(null)
      toast.success("ההעדפה נמחקה")
    } catch (err) {
      console.error("[visual-preferences] delete", err)
      toast.error(err instanceof Error ? err.message : "המחיקה נכשלה, נסו שוב")
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-5 animate-spin text-text-neutral-default" aria-label="טוען" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h3 className="text-p-bold text-text-primary-default">העדפות ויזואליות</h3>
        <p className="text-small text-text-neutral-default">
          מה שביקשתם לשמור בצ׳אט של העריכה עם AI: איך דברים זזים, נכנסים ומתחלפים, הרגלי עימוד ואלמנטים שה-AI מוסיף. כל העדפה
          חלה על הפורמט שלה, או על כל הפורמטים. אפשר לערוך או למחוק בכל רגע.
        </p>
        <p className="text-small text-text-neutral-default">
          צבעים, פונטים ואלמנטים של המותג לא נשמרים כאן. הם נקבעים ב
          <Link
            href={VISUAL_SETTINGS_HREF}
            className="font-semibold text-text-primary-default underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-70 rounded-sm"
          >
            {bt("שפה ויזואלית")}
          </Link>
          .
        </p>
      </div>

      {loadError !== null ? (
        <p role="alert" className="text-small text-text-primary-default">
          לא הצלחנו לטעון את ההעדפות. {loadError} פתחו את המסך מחדש כדי לנסות שוב.
        </p>
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as RuleScope | "talking_head")} dir="rtl">
          <TabsList className="w-full" aria-label="פורמט">
            {RULE_SCOPES.map((s) => (
              <TabsTrigger key={s.id} value={s.id}>
                {s.label}
              </TabsTrigger>
            ))}
            {talkingHead && <TabsTrigger value="talking_head">דיבור למצלמה</TabsTrigger>}
          </TabsList>
          {talkingHead && (
            <TabsContent value="talking_head" className="pt-3">
              <TalkingHeadTemplateSettings />
            </TabsContent>
          )}

          {RULE_SCOPES.map((s) => {
            const items = prefs.filter((p) => p.scope === s.id)
            const look = s.id === "all" ? ownLook : null
            return (
              <TabsContent key={s.id} value={s.id} className="flex flex-col gap-2 pt-3">
                {look && (
                  <OwnCaptionLookItem
                    look={look}
                    disabled={!!busy}
                    deleting={busy?.id === OWN_CAPTION_LOOK_ID && busy.what === "delete"}
                    onDelete={() => void remove(OWN_CAPTION_LOOK_ID)}
                  />
                )}
                {items.length === 0 ? (
                  look ? null : (
                  <div className="rounded-2xl border border-dashed border-border-neutral-default p-6 text-center">
                    <p className="text-small text-text-neutral-default">
                      {s.id === "all"
                        ? "עוד אין העדפות לכל הפורמטים. מה שתבקשו לשמור בצ׳אט של העריכה עם AI יופיע כאן."
                        : `עוד אין העדפות ל${s.label}. מה שתבקשו לשמור בצ׳אט של העריכה עם AI יופיע כאן.`}
                    </p>
                  </div>
                  )
                ) : (
                  <ul className="flex flex-col gap-2">
                    {items.map((p) => {
                      const isEditing = editing?.id === p.id
                      const saving = busy?.id === p.id && busy.what === "save"
                      const deleting = busy?.id === p.id && busy.what === "delete"
                      return (
                        <li
                          key={p.id}
                          className="flex items-start gap-3 rounded-2xl border border-border-neutral-default bg-white dark:bg-gray-10 p-4"
                        >
                          {isEditing ? (
                            <div className="flex flex-1 min-w-0 flex-col gap-2">
                              <Textarea
                                value={editing.text}
                                onChange={(e) => setEditing({ id: p.id, text: e.target.value })}
                                rows={3}
                                autoFocus
                                aria-label="נוסח ההעדפה"
                                className="text-small"
                              />
                              <div className="flex gap-2">
                                <Button size="sm" onClick={() => void save()} disabled={saving || !editing.text.trim()}>
                                  {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                                  שמירה
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => setEditing(null)} disabled={saving}>
                                  ביטול
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                                <p className="text-p text-text-primary-default leading-relaxed">{p.summary_he}</p>
                                {formatDate(p.at) && (
                                  <span className="text-xs-body text-text-neutral-default">{formatDate(p.at)}</span>
                                )}
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label="עריכה"
                                  disabled={!!busy}
                                  onClick={() => setEditing({ id: p.id, text: p.summary_he })}
                                  className="text-text-neutral-default hover:text-text-primary-default"
                                >
                                  <Pencil className="size-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label="מחיקה"
                                  disabled={!!busy}
                                  onClick={() => void remove(p.id)}
                                  className="text-text-neutral-default hover:text-button-destructive-default"
                                >
                                  {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                                </Button>
                              </div>
                            </>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </TabsContent>
            )
          })}
        </Tabs>
      )}
    </div>
  )
}

function Swatch({ color }: { color: string }) {
  // Her own saved colour (data, not a design token).
  return (
    <span
      aria-hidden
      className="inline-block size-3.5 shrink-0 rounded-full border border-border-neutral-default align-middle"
      style={{ backgroundColor: color }}
    />
  )
}

/** "זכור לעתיד" on her own media: how the words look on it, in every format. */
function OwnCaptionLookItem({
  look,
  disabled,
  deleting,
  onDelete,
}: {
  look: CaptionStyle
  disabled: boolean
  deleting: boolean
  onDelete: () => void
}) {
  const box = look.pill && look.pill !== "none" ? look.pill : null
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-border-neutral-default bg-white dark:bg-gray-10 p-4">
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <p className="text-p text-text-primary-default leading-relaxed">מראה הכיתוב על המדיה שלכם, בכל הפורמטים</p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-small text-text-neutral-default">
          {look.pill !== undefined && (
            <li className="flex items-center gap-1.5">
              רקע: {box ? <Swatch color={box} /> : "ללא רקע"}
            </li>
          )}
          {look.text && (
            <li className="flex items-center gap-1.5">
              צבע הטקסט: <Swatch color={look.text} />
            </li>
          )}
          {typeof look.scale === "number" && <li>גודל: {Math.round(look.scale * 100)}%</li>}
          {typeof look.perLine === "boolean" && <li>{look.perLine ? "רקע נפרד לכל שורה" : "רקע אחד לכל הכיתוב"}</li>}
        </ul>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="מחיקה"
        disabled={disabled}
        onClick={onDelete}
        className="shrink-0 text-text-neutral-default hover:text-button-destructive-default"
      >
        {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
      </Button>
    </div>
  )
}
