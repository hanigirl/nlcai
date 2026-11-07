"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Image as ImageIcon, Loader2, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Chip } from "@/components/ui/chip"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { getCurrentUser } from "@/lib/supabase/current-user"
import { userExampleKind } from "@/lib/visual-language/types"

/**
 * Talking head AI edit (Notion: "עריכת דיבור למצלמה, עריכה עם כתוביות, שפה
 * ויזואלית שלהם", Hani 2026-11-07) — the pieces both design variants share:
 *
 *   - the three ways in — chips in the AI panel (✨ on the video; Hani
 *     picked this direction, 2026-11-07): only captions · captions +
 *     supporting elements · her own prompt (TH_EDIT_MODES);
 *   - the PLAN shown before the paid edit for "כתוביות + אלמנטים תומכים":
 *     ~3 moments of her speech, each with its time and the element it gets
 *     (card / highlight / animation) — she fixes, deletes or adds, and only
 *     "אישור" runs the edit (TalkingHeadPlanEditor);
 *   - the cover made on request, not automatically, saying which settings it
 *     follows (TalkingHeadCoverAction), and the reminder before approving a
 *     reel with no cover (TalkingHeadCoverReminder);
 *   - saving what she asked as her template for "איך לייצר סרטון דיבור
 *     למצלמה" (TalkingHeadTemplateChip).
 *
 * Captions (and every text element) are set in the font of her visual
 * language; with none set, Rubik (Hani, 2026-11-07) — the same rule as the
 * own-video animated captions (lib/broll-animation/compose).
 *
 * Gated to Hani + Nataliya (lib/feature-access → canTalkingHeadAi).
 */

export type TalkingHeadEditMode = "captions" | "captions_plus" | "prompt"

export const TH_EDIT_MODES: { id: TalkingHeadEditMode; label: string; hint: string; request: string }[] = [
  {
    id: "captions",
    label: "רק כתוביות",
    hint: "כל מה שאתם אומרים, ככתוביות בשפה הוויזואלית שלכם.",
    request: "להוסיף כתוביות לכל מה שאני אומרת, בשפה הוויזואלית שלי",
  },
  {
    id: "captions_plus",
    label: "כתוביות + אלמנטים תומכים",
    hint: "כתוביות, ובנוסף כרטיסים, הדגשות ואנימציות ברגעים החשובים. קודם תראו את התוכנית.",
    request: "להוסיף כתוביות, ולהדגיש את הרגעים החשובים בדיבור עם כרטיסים, הדגשות ואנימציות מהשפה הוויזואלית שלי",
  },
  {
    id: "prompt",
    label: "לכתוב בעצמי",
    hint: "תארו במילים שלכם מה להוסיף לסרטון.",
    request: "",
  },
]

export type ThElement = "card" | "highlight" | "animation"
export const TH_ELEMENTS: { id: ThElement; label: string }[] = [
  { id: "card", label: "כרטיס" },
  { id: "highlight", label: "הדגשה" },
  { id: "animation", label: "אנימציה" },
]

export type ThPlanMoment = { id: string; at: string; quote: string; element: ThElement }

/** State previews only (no transcript is read there). */
export const SAMPLE_TH_PLAN: ThPlanMoment[] = [
  { id: "m1", at: "0:04", quote: "הלקוח לא קונה שעות. הוא קונה תוצאה.", element: "card" },
  { id: "m2", at: "0:17", quote: "כמה זה שווה לך?", element: "highlight" },
  { id: "m3", at: "0:31", quote: "שלושה צעדים לתמחור לפי תוצאה", element: "animation" },
]

/**
 * The plan before the paid edit. Editable in place; "אישור" runs it.
 * `onApprove` gets the moments as she left them.
 */
export function TalkingHeadPlanEditor({
  initial,
  onApprove,
  approving = false,
  approved = false,
  className,
}: {
  initial: ThPlanMoment[]
  onApprove: (moments: ThPlanMoment[]) => void
  approving?: boolean
  /** After "אישור": read-only. */
  approved?: boolean
  className?: string
}) {
  const [moments, setMoments] = useState<ThPlanMoment[]>(initial)
  const set = (id: string, patch: Partial<ThPlanMoment>) =>
    setMoments((list) => list.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  const locked = approved || approving
  return (
    <div className={cn("flex flex-col gap-2 rounded-xl border border-border-neutral-default bg-white p-3 dark:bg-gray-10", className)}>
      <p className="text-xs-body text-text-neutral-default">
        {approved ? "התוכנית שאישרתם:" : "מה אדגיש בסרטון. אפשר לתקן, למחוק או להוסיף רגע, ורק אחרי אישור אערוך."}
      </p>
      <ol className="flex flex-col gap-2" aria-label="הרגעים שיודגשו">
        {moments.map((m, i) => (
          <li key={m.id} className="flex flex-col gap-1.5 rounded-lg bg-bg-surface p-2">
            <div className="flex items-center gap-1.5">
              <span className="w-5 shrink-0 text-center text-xs-body tabular-nums text-text-neutral-default">{i + 1}</span>
              <Input
                inputSize="small"
                value={m.at}
                onChange={(e) => set(m.id, { at: e.target.value })}
                disabled={locked}
                aria-label={`זמן ברגע ${i + 1}`}
                dir="ltr"
                className="w-16 shrink-0 text-center tabular-nums"
              />
              <Select
                selectSize="small"
                value={m.element}
                onChange={(e) => set(m.id, { element: e.target.value as ThElement })}
                disabled={locked}
                aria-label={`סוג האלמנט ברגע ${i + 1}`}
                className="py-0 text-small leading-normal"
              >
                {TH_ELEMENTS.map((el) => (
                  <option key={el.id} value={el.id}>
                    {el.label}
                  </option>
                ))}
              </Select>
              {!locked && (
                <button
                  type="button"
                  onClick={() => setMoments((list) => list.filter((x) => x.id !== m.id))}
                  aria-label={`מחיקת רגע ${i + 1}`}
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-text-neutral-default transition-colors hover:bg-gray-95 hover:text-text-primary-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 dark:hover:bg-gray-20"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
            <Input
              inputSize="small"
              value={m.quote}
              onChange={(e) => set(m.id, { quote: e.target.value })}
              disabled={locked}
              aria-label={`המשפט ברגע ${i + 1}`}
              placeholder="המשפט או הרגע מהדיבור"
            />
          </li>
        ))}
      </ol>
      {!locked && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1 px-2 text-text-neutral-default hover:bg-gray-95 dark:hover:bg-gray-20"
            onClick={() =>
              setMoments((list) => [...list, { id: `m${Date.now()}`, at: "", quote: "", element: "card" }])
            }
          >
            <Plus className="size-4" aria-hidden />
            הוספת רגע
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8 rounded-full px-4"
            disabled={!moments.length || moments.some((m) => !m.quote.trim())}
            onClick={() => onApprove(moments)}
          >
            אישור ועריכה
          </Button>
        </div>
      )}
      {approving && (
        <p className="flex items-center gap-1.5 text-xs-body text-text-neutral-default" role="status">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          עורכים את הסרטון לפי התוכנית...
        </p>
      )}
    </div>
  )
}

/**
 * Whether she set up covers: cover examples filed under Settings → מדיה →
 * דוגמאות לשימוש → קאברים. null while reading.
 */
export function useHasCoverSettings(enabled = true): boolean | null {
  const [has, setHas] = useState<boolean | null>(null)
  useEffect(() => {
    if (!enabled) return
    let live = true
    void (async () => {
      const supabase = createClient()
      const {
        data: { user },
      } = await getCurrentUser(supabase)
      if (!user) {
        if (live) setHas(false)
        return
      }
      const { data } = await supabase
        .from("user_media")
        .select("metadata")
        .eq("user_id", user.id)
        .eq("category", "brand_example")
      const rows = (data ?? []) as { metadata: Record<string, unknown> | null }[]
      if (live) setHas(rows.some((r) => userExampleKind(r.metadata) === "cover"))
    })()
    return () => {
      live = false
    }
  }, [enabled])
  return has
}

/** Where her cover settings live: Settings → מדיה → דוגמאות לשימוש → קאברים. */
export const COVER_SETTINGS_HREF = "/settings?tab=media&sub=covers"

/** "יצירת קאבר" — made when she asks, saying which settings it follows. */
export function TalkingHeadCoverAction({
  hasCoverSettings,
  brandBackground = false,
  loading = false,
  onCreate,
  className,
}: {
  hasCoverSettings: boolean
  /** No cover settings: the default's background is her main brand colour (else black). */
  brandBackground?: boolean
  loading?: boolean
  onCreate: () => void
  className?: string
}) {
  return (
    <div className={cn("flex flex-col items-center gap-1.5", className)}>
      <Button type="button" variant="outline" onClick={onCreate} disabled={loading} className="w-full gap-2 rounded-[10px]">
        {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ImageIcon className="size-4" aria-hidden />}
        {loading ? "יוצרים קאבר..." : "יצירת קאבר"}
      </Button>
      <p className="text-center text-xs-body text-text-neutral-default">
        {hasCoverSettings ? (
          "הקאבר ייווצר לפי הגדרות הקאבר שלכם."
        ) : (
          <>
            הקאבר ייווצר בברירת המחדל: Rubik על רקע {brandBackground ? "צבע המותג שלכם" : "שחור"}.{" "}
            <Link href={COVER_SETTINGS_HREF} className="underline underline-offset-2 hover:text-text-primary-default">
              לשינוי ההגדרות
            </Link>
          </>
        )}
      </p>
    </div>
  )
}

/** The cover once made: a small preview and a way to make it again. */
export function TalkingHeadCoverDone({
  image,
  loading = false,
  onRemake,
}: {
  /** base64 PNG, as the cover route returns it. */
  image: string
  loading?: boolean
  onRemake: () => void
}) {
  const src = image.startsWith("data:") || image.startsWith("http") || image.startsWith("/") ? image : `data:image/png;base64,${image}`
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border-neutral-default bg-white p-2 dark:bg-gray-10">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="הקאבר של הרילס" className="aspect-[9/16] w-12 rounded-md object-cover" />
      <span className="flex-1 text-small text-text-primary-default">קאבר לרילס</span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={onRemake}
        disabled={loading}
        className="gap-1.5 text-text-neutral-default hover:bg-gray-95 dark:hover:bg-gray-20"
      >
        {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {loading ? "יוצרים..." : "ליצור מחדש"}
      </Button>
    </div>
  )
}

/** Before approving a reel with no cover: seen, never skipped silently. */
export function TalkingHeadCoverReminder({
  loading = false,
  onCreate,
  onApproveWithout,
}: {
  loading?: boolean
  onCreate: () => void
  onApproveWithout: () => void
}) {
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-xl border border-border-neutral-default bg-bg-surface p-3">
      <p className="flex items-center gap-1.5 text-small text-text-primary-default">
        <ImageIcon className="size-4 text-text-neutral-default" aria-hidden />
        עוד אין קאבר לרילס. ליצור עכשיו?
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={onCreate} disabled={loading} className="gap-1.5">
          {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {loading ? "יוצרים קאבר..." : "יצירת קאבר"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onApproveWithout}
          className="text-text-neutral-default hover:bg-gray-95 dark:hover:bg-gray-20"
        >
          לאשר בלי קאבר
        </Button>
      </div>
    </div>
  )
}

/** Save what she asked as her template for every talking head video. */
/** The panel's chip: adds what she asked to her template (api/visual-language/talking-head-template). */
export async function appendToTalkingHeadTemplate(request: string): Promise<boolean> {
  try {
    const res = await fetch("/api/visual-language/talking-head-template", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ append: request }),
    })
    return res.ok
  } catch {
    return false
  }
}

export function TalkingHeadTemplateChip({ onSave }: { onSave?: () => Promise<boolean> | boolean }) {
  const [state, setState] = useState<"ready" | "saving" | "saved">("ready")
  if (state === "saved") {
    return (
      <span className="text-xs-body text-text-neutral-default" role="status">
        נשמר בהגדרות, תחת ״איך לייצר סרטון דיבור למצלמה״. כך ייערכו מעכשיו הסרטונים הבאים.
      </span>
    )
  }
  return (
    <Chip
      disabled={state === "saving"}
      onClick={async () => {
        setState("saving")
        const ok = onSave ? await onSave() : true
        setState(ok ? "saved" : "ready")
      }}
    >
      {state === "saving" && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      לשמור כתבנית לסרטוני דיבור למצלמה
    </Chip>
  )
}

/**
 * Settings → מדיה → העדפות ויזואליות → דיבור למצלמה (Hani, 2026-11-07):
 * "איך לייצר סרטון דיבור למצלמה" — her instructions for every AI edit of a
 * talking-head video, editable. `initial`: state previews only (no fetch).
 */
export function TalkingHeadTemplateSettings({ initial }: { initial?: string }) {
  const [text, setText] = useState(initial ?? "")
  const [saved, setSaved] = useState(initial ?? "")
  const [loading, setLoading] = useState(initial === undefined)
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle")
  useEffect(() => {
    if (initial !== undefined) return
    let live = true
    fetch("/api/visual-language/talking-head-template")
      .then((r) => (r.ok ? r.json() : { instructions: "" }))
      .then((d: { instructions?: string }) => {
        if (!live) return
        setText(d.instructions ?? "")
        setSaved(d.instructions ?? "")
      })
      .catch(() => undefined)
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [initial])
  const save = async () => {
    setState("saving")
    try {
      const res = await fetch("/api/visual-language/talking-head-template", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instructions: text }),
      })
      if (!res.ok) throw new Error(String(res.status))
      setSaved(text.trim())
      setState("saved")
    } catch {
      setState("error")
    }
  }
  return (
    <section className="flex flex-col gap-3" aria-label="איך לייצר סרטון דיבור למצלמה">
      <div className="flex flex-col gap-1">
        <h3 className="text-p-bold text-text-primary-default">איך לייצר סרטון דיבור למצלמה</h3>
        <p className="text-small text-text-neutral-default">
          ההוראות האלה חלות על כל עריכה עם AI של סרטון דיבור למצלמה: כתוביות, אלמנטים, הדגשות ואנימציות. אפשר לכתוב כאן, או לשמור מהצ׳אט של העריכה עם ״לשמור כתבנית לסרטוני דיבור למצלמה״.
        </p>
      </div>
      {loading ? (
        <Loader2 className="size-5 animate-spin text-text-neutral-default" aria-label="טוען" />
      ) : (
        <>
          <Textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setState("idle")
            }}
            rows={6}
            aria-label="ההוראות לסרטוני דיבור למצלמה"
            placeholder="למשל: כתוביות גדולות בתחתית, מילת המפתח בכל משפט מודגשת בצבע המותג, כרטיס עם שלושת הצעדים כשאני מונה אותם."
            className="text-small"
          />
          <div className="flex items-center gap-3">
            <Button type="button" size="sm" onClick={save} disabled={state === "saving" || text.trim() === saved.trim()} className="gap-1.5">
              {state === "saving" && <Loader2 className="size-4 animate-spin" aria-hidden />}
              שמירה
            </Button>
            <span className="text-xs-body text-text-neutral-default" role="status">
              {state === "saved" ? "נשמר. העריכה הבאה תעבוד לפי זה." : state === "error" ? "לא הצלחנו לשמור. נסו שוב." : ""}
            </span>
          </div>
        </>
      )}
    </section>
  )
}
