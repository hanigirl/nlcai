"use client"

/**
 * Design review — task "להכניס תיקיית מדיה מדרייב בהגדרות, ובקנבס כשבוחרים
 * במדיה מגוגל דרייב כבר תופיע תצוגה מקדימה של אותה מדיה".
 *
 * Settings → מדיה gets a third page, "מדיה מ-Google Drive": one shared folder
 * per kind of media (b-roll, talking head, images, story, carousel), each in
 * an accordion row, view-only links only. On the canvas, "Google Drive" in a
 * format's media panel swaps the panel for a gallery of that folder (the
 * avatar picker's look) with a back chevron. Both directions share all of
 * that; they differ in how ORDER is chosen for a multi-frame format and in
 * where a missing folder gets connected:
 *
 *   A — slide first. A strip of numbered slots (one per slide of the script,
 *       with that slide's words shown) sits above the gallery. Pick the slot,
 *       tap a picture, the slot fills and the next empty one lights up.
 *       Single-frame formats: one tap picks (exactly like the avatars).
 *       No folder yet → a door to Settings.
 *   B — picture first. Tap pictures in the order they should appear; each
 *       gets a number. The order lives in a tray at the bottom where it can be
 *       dragged. Single-frame formats: tap to select, confirm in the tray.
 *       No folder yet → paste the folder link right there in the panel.
 *
 * REVIEW ONLY, behind `?drivepick=a|b`. Nothing here calls Drive, a
 * generation route or the DB: the folders are seeded, "checking a link" and
 * "importing" are timers, and every bit of state lives in this module's
 * store, so the review bar, Settings and the panel move together.
 *
 * In production the picker's output is exactly what the existing
 * DriveMediaLinks rows hold today — an ordered list of Drive file links, row
 * i = frame i — fed to the import that already exists. The picker replaces
 * the typing, not the pipeline.
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { useSearchParams } from "next/navigation"
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ExternalLink,
  FolderOpen,
  GripVertical,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import { parseTextToSlides } from "@/lib/carousel-slides"

/* ================================================================ types */

export type DrivePickVariant = "a" | "b"

export type FolderKey = "broll" | "talking" | "images" | "story" | "carousel"

type MediaItem = {
  id: string
  name: string
  thumb: string
  kind: "image" | "video"
  /** "0:24" — videos only. */
  duration?: string
}

type FolderError = "not_drive" | "file_not_folder" | "not_public"

type Folder = {
  status: "unset" | "checking" | "connected" | "error"
  link: string
  /** Drive's own folder name, read on connect. */
  name: string
  items: MediaItem[]
  error: FolderError | null
  /** Shared as "anyone with the link · editor" — works, but worth a nudge. */
  editorLink: boolean
}

type Store = {
  folders: Record<FolderKey, Folder>
  /** The format whose panel is currently swapped for the gallery. */
  pickerFor: string | null
  /** Review toggle: the gallery is still fetching the folder. */
  forceLoading: boolean
  /** Format → what was picked, in order. */
  picked: Record<string, MediaItem[]>
  importing: string | null
  importProgress: string
}

/* ================================================================ seed */

const IMG = (n: string) => `/review/drive-folder/p${n}.jpg`

const FOLDER_META: Record<FolderKey, { label: string; driveName: string; kindLabel: string }> = {
  broll: { label: "בי-רולים", driveName: "בי-רולים לרילס", kindLabel: "סרטונים קצרים לרקע" },
  talking: { label: "דיבור למצלמה", driveName: "צילומי דיבור למצלמה", kindLabel: "סרטונים שצילמתם מדברים" },
  images: { label: "תמונות", driveName: "תמונות לפוסטים", kindLabel: "תמונות לפוסט תמונה" },
  story: { label: "סטורי", driveName: "סטוריז", kindLabel: "תמונות וסרטונים אנכיים" },
  carousel: { label: "קרוסלות", driveName: "שקופיות לקרוסלה", kindLabel: "תמונות לשקופיות" },
}

const FOLDER_ORDER: FolderKey[] = ["broll", "talking", "images", "story", "carousel"]

export const FORMAT_FOLDER: Record<string, FolderKey> = {
  b_roll: "broll",
  talking_head: "talking",
  image_post: "images",
  story: "story",
  carousel: "carousel",
}

const v = (id: string, name: string, n: string, duration: string): MediaItem => ({
  id,
  name,
  thumb: IMG(n),
  kind: "video",
  duration,
})
const im = (id: string, name: string, n: string): MediaItem => ({ id, name, thumb: IMG(n), kind: "image" })

const SEED_ITEMS: Record<FolderKey, MediaItem[]> = {
  broll: [
    v("br1", "קפה בבוקר.mov", "1060", "0:12"),
    v("br2", "הקלדה במחשב.mp4", "0", "0:08"),
    v("br3", "מחברת ועט.mp4", "20", "0:15"),
    v("br4", "שולחן עבודה.mov", "48", "0:10"),
    v("br5", "הליכה בעיר.mp4", "42", "0:21"),
    v("br6", "טלפון ביד.mp4", "26", "0:09"),
  ],
  talking: [
    v("th1", "פתיח — 3 טעויות.mp4", "1", "0:48"),
    v("th2", "טיפ על מחירים.mov", "180", "1:05"),
    v("th3", "סיפור לקוחה.mp4", "201", "0:52"),
    v("th4", "שאלות ותשובות.mp4", "3", "1:31"),
  ],
  images: [
    im("im1", "שולחן בהיר.jpg", "60"),
    im("im2", "כוס תה.jpg", "225"),
    im("im3", "מחשב פתוח.jpg", "119"),
    im("im4", "ספרים.jpg", "24"),
    im("im5", "בית קפה.jpg", "431"),
    im("im6", "פינת עבודה.jpg", "7"),
    im("im7", "נוף.jpg", "366"),
    im("im8", "קפה.jpg", "1060"),
  ],
  story: [
    im("st1", "בוקר.jpg", "225"),
    v("st2", "מאחורי הקלעים.mp4", "1", "0:14"),
    im("st3", "השולחן שלי.jpg", "60"),
    im("st4", "פגישה.jpg", "431"),
    v("st5", "דרך לסדנה.mp4", "42", "0:11"),
    im("st6", "ספר חדש.jpg", "24"),
  ],
  carousel: [
    im("ca1", "שער.jpg", "20"),
    im("ca2", "טעות 1.jpg", "0"),
    im("ca3", "טעות 2.jpg", "48"),
    im("ca4", "טעות 3.jpg", "119"),
    im("ca5", "סיכום.jpg", "60"),
    im("ca6", "מחשב.jpg", "180"),
    im("ca7", "בית קפה.jpg", "431"),
    im("ca8", "ספרים.jpg", "24"),
    im("ca9", "תה.jpg", "225"),
  ],
}

const SAMPLE_LINK = (k: FolderKey) => `https://drive.google.com/drive/folders/1${k}NoaCohenMedia?usp=sharing`

const connected = (k: FolderKey): Folder => ({
  status: "connected",
  link: SAMPLE_LINK(k),
  name: FOLDER_META[k].driveName,
  items: SEED_ITEMS[k],
  error: null,
  editorLink: false,
})
const unset = (): Folder => ({ status: "unset", link: "", name: "", items: [], error: null, editorLink: false })
const failed = (k: FolderKey, error: FolderError): Folder => ({
  ...unset(),
  status: "error",
  link: error === "not_public" ? SAMPLE_LINK(k).replace("sharing", "restricted") : "",
  error,
})

/** What Settings looks like on a first visit to the review link: a bit of everything. */
function mixedFolders(): Record<FolderKey, Folder> {
  return {
    broll: connected("broll"),
    talking: connected("talking"),
    images: unset(),
    story: failed("story", "not_public"),
    carousel: connected("carousel"),
  }
}

/* ================================================================ store */

let store: Store = {
  folders: mixedFolders(),
  pickerFor: null,
  forceLoading: false,
  picked: {},
  importing: null,
  importProgress: "",
}
const listeners = new Set<() => void>()
const set = (patch: Partial<Store>) => {
  store = { ...store, ...patch }
  listeners.forEach((l) => l())
}
const setFolder = (k: FolderKey, patch: Partial<Folder>) =>
  set({ folders: { ...store.folders, [k]: { ...store.folders[k], ...patch } } })
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
const snapshot = () => store

export function useDrivePickStore(): Store {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/** `?drivepick=a|b` → the direction under review; null in production. */
export function useDrivePickVariant(): DrivePickVariant | null {
  const params = useSearchParams()
  const p = params.get("drivepick")
  return p === "a" || p === "b" ? p : null
}

export function openDrivePicker(format: string) {
  set({ pickerFor: format })
}
export function closeDrivePicker() {
  set({ pickerFor: null })
}

/* ---------------------------------------------- simulated link check */

const ERROR_COPY: Record<FolderError, { title: string; fix: string }> = {
  not_drive: {
    title: "זה לא קישור מגוגל דרייב",
    fix: "העתיקו את הקישור מהדרייב עצמו — הוא מתחיל ב-drive.google.com.",
  },
  file_not_folder: {
    title: "זה קישור לקובץ אחד, לא לתיקייה",
    fix: "פתחו בדרייב את התיקייה עצמה ושתפו אותה — לא קובץ שבתוכה.",
  },
  not_public: {
    title: "התיקייה לא פתוחה לצפייה",
    fix: "בדרייב: לחיצה ימנית על התיקייה ← שיתוף ← גישה כללית ← „כל מי שיש לו את הקישור” ← צופה. אחר כך הדביקו את הקישור שוב.",
  },
}

/**
 * Stands in for the real check (a server call that lists the folder with
 * the public link). Any link with "folders/" connects; the words below in
 * the link trigger the other outcomes so every state can be reached by hand:
 * "private" → not shared, "file/d/" → a file, "empty" → an empty folder,
 * "edit" → shared as editor.
 */
function classifyLink(raw: string): { error: FolderError } | { empty: boolean; editor: boolean } {
  const url = raw.trim()
  if (!/drive\.google\.com|docs\.google\.com/i.test(url)) return { error: "not_drive" }
  if (/\/file\/d\//.test(url)) return { error: "file_not_folder" }
  if (/private|restricted/i.test(url)) return { error: "not_public" }
  if (!/\/folders\//.test(url)) return { error: "file_not_folder" }
  return { empty: /empty/i.test(url), editor: /edit/i.test(url) }
}

const checkTimers: Partial<Record<FolderKey, ReturnType<typeof setTimeout>>> = {}

export function connectFolder(k: FolderKey, link: string) {
  if (checkTimers[k]) clearTimeout(checkTimers[k])
  if (!link.trim()) {
    setFolder(k, unset())
    return
  }
  setFolder(k, { status: "checking", link, error: null })
  checkTimers[k] = setTimeout(() => {
    const r = classifyLink(link)
    if ("error" in r) {
      setFolder(k, { status: "error", error: r.error, items: [], name: "" })
    } else {
      setFolder(k, {
        status: "connected",
        error: null,
        name: FOLDER_META[k].driveName,
        items: r.empty ? [] : SEED_ITEMS[k],
        editorLink: r.editor,
      })
    }
  }, 1100)
}

export function disconnectFolder(k: FolderKey) {
  setFolder(k, unset())
}

/* ------------------------------------------------- simulated import */

let importTimer: ReturnType<typeof setTimeout> | null = null

function runImport(format: string, items: MediaItem[]) {
  if (items.length === 0) return
  if (importTimer) clearTimeout(importTimer)
  const unit = format === "carousel" ? "שקופית" : format === "story" ? "פריים" : null
  let i = 0
  const step = () => {
    i += 1
    set({
      importing: format,
      importProgress: unit
        ? `מייבאים ${unit} ${i} מתוך ${items.length}...`
        : items[0].kind === "video"
          ? "מחברים את הסרטון מהדרייב..."
          : "מייבאים את התמונה...",
    })
    if (i < items.length) {
      importTimer = setTimeout(step, 450)
    } else {
      importTimer = setTimeout(() => {
        set({
          importing: null,
          importProgress: "",
          picked: { ...store.picked, [format]: items },
          pickerFor: null,
        })
      }, 600)
    }
  }
  step()
}

/* ------------------------------------------------- review-bar presets */

type PanelPreset = "connected" | "loading" | "empty" | "no_access" | "unset"

const PANEL_PRESETS: { id: PanelPreset; label: string }[] = [
  { id: "connected", label: "תיקייה מחוברת" },
  { id: "loading", label: "טוען" },
  { id: "empty", label: "תיקייה ריקה" },
  { id: "no_access", label: "אין גישה" },
  { id: "unset", label: "לא חוברה תיקייה" },
]

function currentPreset(s: Store, k: FolderKey): PanelPreset {
  if (s.forceLoading) return "loading"
  const f = s.folders[k]
  if (f.status === "error" && f.error === "not_public") return "no_access"
  if (f.status === "connected" && f.items.length === 0) return "empty"
  if (f.status === "connected") return "connected"
  return "unset"
}

function applyPreset(k: FolderKey, p: PanelPreset) {
  if (importTimer) clearTimeout(importTimer)
  const base = { forceLoading: p === "loading", importing: null, importProgress: "" }
  const f: Folder =
    p === "empty"
      ? { ...connected(k), items: [] }
      : p === "no_access"
        ? failed(k, "not_public")
        : p === "unset"
          ? unset()
          : connected(k)
  set({ ...base, folders: { ...store.folders, [k]: f } })
}

const FORMAT_TABS: { id: string; label: string }[] = [
  { id: "carousel", label: "קרוסלה" },
  { id: "story", label: "סטורי" },
  { id: "image_post", label: "פוסט תמונה" },
  { id: "b_roll", label: "בי-רול" },
  { id: "talking_head", label: "דיבור למצלמה" },
]

const VARIANT_NAME: Record<DrivePickVariant, string> = {
  a: "א׳ — שקופית אחרי שקופית",
  b: "ב׳ — בוחרים לפי הסדר",
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50",
        active
          ? "border-yellow-50 bg-yellow-95 text-text-primary-default dark:bg-gray-20"
          : "border-border-neutral-default text-text-neutral-default hover:bg-bg-surface-hover",
      )}
    >
      {children}
    </button>
  )
}

/**
 * The strip pinned to the top of a review link. On /project it switches the
 * format and the folder's state; on /settings it resets the folders.
 */
export function DrivePickReviewBar({
  variant,
  surface,
  activeFormat,
  onFormatChange,
}: {
  variant: DrivePickVariant
  surface: "project" | "settings"
  activeFormat?: string | null
  onFormatChange?: (format: string) => void
}) {
  const s = useDrivePickStore()
  const other: DrivePickVariant = variant === "a" ? "b" : "a"
  const fmt = activeFormat ?? s.pickerFor ?? "carousel"
  const folderKey = FORMAT_FOLDER[fmt] ?? "carousel"
  const preset = currentPreset(s, folderKey)
  const otherHref =
    surface === "project"
      ? `/project?drivepick=${other}`
      : `/settings?tab=media&sub=drive&drivepick=${other}`
  return (
    <div
      dir="rtl"
      className="fixed inset-x-0 top-0 z-[60] flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 border-b border-border-neutral-default bg-white/95 px-4 py-2 text-xs shadow-sm backdrop-blur dark:bg-gray-10/95"
      style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.5rem)" }}
    >
      <span className="font-semibold text-text-primary-default">
        תצוגת בדיקה · הצעה {VARIANT_NAME[variant]}
      </span>
      {surface === "project" ? (
        <>
          <div role="radiogroup" aria-label="פורמט לבדיקה" className="flex flex-wrap gap-1">
            {FORMAT_TABS.map((t) => (
              <Chip key={t.id} active={fmt === t.id} onClick={() => onFormatChange?.(t.id)}>
                {t.label}
              </Chip>
            ))}
          </div>
          <span className="text-text-neutral-default">מצב התיקייה:</span>
          <div role="radiogroup" aria-label="מצב התיקייה לבדיקה" className="flex flex-wrap gap-1">
            {PANEL_PRESETS.map((p) => (
              <Chip key={p.id} active={preset === p.id} onClick={() => applyPreset(folderKey, p.id)}>
                {p.label}
              </Chip>
            ))}
          </div>
          <a
            href={`/settings?tab=media&sub=drive&drivepick=${variant}`}
            className="text-text-primary-default underline underline-offset-2"
          >
            להגדרות
          </a>
        </>
      ) : (
        <div role="radiogroup" aria-label="מצב התיקיות לבדיקה" className="flex flex-wrap gap-1">
          <Chip active={false} onClick={() => set({ folders: mixedFolders() })}>
            מצב מעורב
          </Chip>
          <Chip
            active={false}
            onClick={() =>
              set({
                folders: Object.fromEntries(FOLDER_ORDER.map((k) => [k, unset()])) as Record<FolderKey, Folder>,
              })
            }
          >
            הכל ריק
          </Chip>
          <a
            href={`/project?drivepick=${variant}`}
            className="text-text-primary-default underline underline-offset-2"
          >
            לקנבס
          </a>
        </div>
      )}
      <a href={otherHref} className="text-text-primary-default underline underline-offset-2">
        להצעה {other === "a" ? "א׳" : "ב׳"}
      </a>
      <span className="text-text-neutral-default">בלי קרדיטים, בלי שמירה</span>
    </div>
  )
}

/* ================================================================ shared bits */

function DriveMark({ className }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/images/google-drive.svg" alt="" className={cn("size-4 shrink-0", className)} />
}

function ErrorBlock({ error }: { error: FolderError }) {
  const c = ERROR_COPY[error]
  return (
    <div role="alert" className="flex flex-col gap-1">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-button-destructive-default">
        <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
        {c.title}
      </p>
      <p className="text-xs-body text-text-neutral-default">{c.fix}</p>
    </div>
  )
}

/** One folder-link field — Settings and B's in-panel connect use the same one. */
function FolderLinkField({ folderKey, autoFocus }: { folderKey: FolderKey; autoFocus?: boolean }) {
  const s = useDrivePickStore()
  const f = s.folders[folderKey]
  const [draft, setDraft] = useState(f.link)
  // Pasting a link is the instruction — no "connect" button (same rule as
  // the per-frame Drive rows, Hani 2026-07-29).
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])
  return (
    <div className="flex flex-col gap-2">
      <Input
        dir="ltr"
        inputSize="small"
        type="url"
        value={draft}
        autoFocus={autoFocus}
        onChange={(e) => {
          const next = e.target.value
          setDraft(next)
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => connectFolder(folderKey, next), 700)
        }}
        placeholder="https://drive.google.com/drive/folders/..."
        disabled={f.status === "checking"}
        aria-invalid={f.status === "error"}
        aria-label={`קישור לתיקיית ${FOLDER_META[folderKey].label}`}
        className="text-xs"
      />
      {f.status === "checking" ? (
        <p className="flex items-center gap-2 text-xs text-text-neutral-default" role="status">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          בודקים את התיקייה...
        </p>
      ) : f.status === "error" && f.error ? (
        <ErrorBlock error={f.error} />
      ) : (
        <p className="text-xs-body text-text-neutral-default">
          קישור לתיקייה ששותפה ב„כל מי שיש לו את הקישור” · צופה.
        </p>
      )}
    </div>
  )
}

/* ================================================================ settings */

/** Settings → מדיה → מדיה מ-Google Drive. Identical in both directions. */
export function DriveFoldersSettings() {
  const s = useDrivePickStore()
  const [open, setOpen] = useState<FolderKey | null>("images")
  const connectedCount = FOLDER_ORDER.filter((k) => s.folders[k].status === "connected").length

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h3 className="flex items-center gap-2 text-p-bold text-text-primary-default">
          <DriveMark className="size-5" />
          מדיה מ-Google Drive
        </h3>
        <p className="text-small text-text-neutral-default">
          חברו תיקייה אחת לכל סוג מדיה. בקנבס תראו את מה שיש בה ותבחרו בלחיצה — בלי להדביק קישור לכל קובץ.
        </p>
        <p className="text-xs-body text-text-neutral-default">
          {connectedCount} מתוך {FOLDER_ORDER.length} תיקיות מחוברות
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {FOLDER_ORDER.map((k) => (
          <FolderRow key={k} folderKey={k} open={open === k} onOpenChange={(o) => setOpen(o ? k : null)} />
        ))}
      </div>

      <details className="group rounded-xl bg-bg-surface px-4 py-3 text-xs-body text-text-neutral-default">
        <summary className="cursor-pointer list-none font-semibold text-text-primary-default [&::-webkit-details-marker]:hidden">
          איך משתפים תיקייה לצפייה?
        </summary>
        <ol className="mt-2 flex list-decimal flex-col gap-1 ps-4">
          <li>בדרייב, לחיצה ימנית על התיקייה ← שיתוף.</li>
          <li>בגישה כללית בוחרים „כל מי שיש לו את הקישור”.</li>
          <li>משאירים את ההרשאה על „צופה” ומעתיקים את הקישור.</li>
        </ol>
        <p className="mt-2">
          קבצים חדשים שתוסיפו לתיקייה יופיעו בקנבס לבד — לא צריך לחבר שוב.
        </p>
      </details>
    </div>
  )
}

function FolderSummary({ f }: { f: Folder }) {
  if (f.status === "checking") return <>בודקים...</>
  if (f.status === "error")
    return <span className="text-button-destructive-default">{f.error === "not_public" ? "אין גישה לתיקייה" : "הקישור לא תקין"}</span>
  if (f.status === "unset") return <>עוד לא חוברה תיקייה</>
  if (f.items.length === 0) return <>מחוברת · ריקה</>
  return (
    <span className="flex items-center gap-1.5">
      <span className="flex -space-x-1.5 space-x-reverse" aria-hidden>
        {f.items.slice(0, 3).map((it) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={it.id} src={it.thumb} alt="" className="h-5 w-4 rounded-[4px] border border-white object-cover dark:border-gray-10" />
        ))}
      </span>
      {f.items.length} קבצים
    </span>
  )
}

function FolderRow({
  folderKey,
  open,
  onOpenChange,
}: {
  folderKey: FolderKey
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const s = useDrivePickStore()
  const f = s.folders[folderKey]
  const meta = FOLDER_META[folderKey]
  // "Replace" stays open until a DIFFERENT folder connects.
  const [replacingFrom, setReplacingFrom] = useState<string | null>(null)
  const replacing = replacingFrom !== null && !(f.status === "connected" && f.link !== replacingFrom)
  const setReplacing = (on: boolean) => setReplacingFrom(on ? f.link : null)
  const showField = f.status !== "connected" || replacing

  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className="rounded-2xl border border-border-neutral-default bg-white dark:bg-gray-10"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-start transition-colors hover:bg-bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50">
        <FolderOpen className="size-4 shrink-0 text-text-neutral-default" aria-hidden />
        <span className="text-small-bold text-text-primary-default">תיקייה ל{meta.label}</span>
        <span className="ms-auto flex min-w-0 items-center truncate text-xs-body text-text-neutral-default">
          <FolderSummary f={f} />
        </span>
        <ChevronDown
          className={cn("size-4 shrink-0 text-text-neutral-default transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-3 px-4 pb-4">
        <p className="text-small text-text-neutral-default">{meta.kindLabel}.</p>

        {f.status === "connected" && !replacing && (
          <div className="flex flex-col gap-3 rounded-xl bg-bg-surface p-3">
            <div className="flex items-center gap-2">
              <DriveMark />
              <span className="truncate text-small-bold text-text-primary-default">{f.name}</span>
              <span className="text-xs-body text-text-neutral-default">· {f.items.length} קבצים</span>
              <a
                href={f.link}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="פתיחה בדרייב"
                title="פתיחה בדרייב"
                className="ms-auto inline-flex size-7 items-center justify-center rounded-md text-text-neutral-default transition-colors hover:bg-bg-surface-hover hover:text-text-primary-default"
              >
                <ExternalLink className="size-3.5" />
              </a>
            </div>
            {f.items.length > 0 ? (
              <div className="flex gap-1.5">
                {f.items.slice(0, 6).map((it) => (
                  <div key={it.id} className={cn("relative shrink-0 overflow-hidden rounded-lg bg-gray-90", THUMB)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={it.thumb} alt={it.name} className="size-full object-cover" />
                    {it.kind === "video" && (
                      <Play className="absolute inset-0 m-auto size-3.5 fill-white text-white drop-shadow" aria-hidden />
                    )}
                  </div>
                ))}
                {f.items.length > 6 && (
                  <span className={cn("flex shrink-0 items-center justify-center rounded-lg bg-gray-90 text-xs text-text-neutral-default dark:bg-gray-20", THUMB)}>
                    <span dir="ltr">+{f.items.length - 6}</span>
                  </span>
                )}
              </div>
            ) : (
              <p className="text-xs-body text-text-neutral-default">
                התיקייה מחוברת אבל עדיין ריקה. קבצים שתוסיפו לה בדרייב יופיעו כאן ובקנבס.
              </p>
            )}
            {f.editorLink && (
              <p className="flex items-start gap-1.5 rounded-lg bg-yellow-95 px-2.5 py-2 text-xs-body text-yellow-20 dark:bg-gray-20 dark:text-yellow-80">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                הקישור פותח את התיקייה לעריכה לכל מי שיש לו אותו. מספיק „צופה” — כדאי לשנות בדרייב.
              </p>
            )}
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setReplacing(true)}>
                החלפת תיקייה
              </Button>
              <button
                type="button"
                onClick={() => disconnectFolder(folderKey)}
                className="rounded-md px-2 py-1 text-xs text-text-neutral-default transition-colors hover:bg-bg-surface-hover hover:text-button-destructive-default"
              >
                ניתוק
              </button>
            </div>
          </div>
        )}

        {showField && <FolderLinkField key={`${folderKey}:${replacing}`} folderKey={folderKey} autoFocus={replacing} />}
        {replacing && (
          <button
            type="button"
            onClick={() => setReplacing(false)}
            className="self-start text-xs text-text-neutral-default hover:text-text-primary-default"
          >
            ביטול
          </button>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

/* ================================================================ panel entry */

/**
 * What stands where the Drive section used to be in a format's media panel:
 * one button that swaps the panel for the folder, plus what was last picked.
 */
export function DriveFolderEntry({ format }: { format: string }) {
  const s = useDrivePickStore()
  const k = FORMAT_FOLDER[format] ?? "images"
  const f = s.folders[k]
  const picked = s.picked[format]
  const multi = format === "carousel" || format === "story"

  return (
    <div className="flex flex-col gap-2">
      {picked && picked.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-border-neutral-default p-3">
          <p className="text-xs-body text-text-neutral-default">
            {multi
              ? `נבחרו ${picked.length} ${format === "carousel" ? "שקופיות" : "פריימים"} מהתיקייה, לפי הסדר:`
              : "נבחר מהתיקייה:"}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {picked.map((it, i) => (
              <div
                key={`${it.id}-${i}`}
                className={cn(
                  "relative shrink-0 overflow-hidden rounded-lg bg-gray-90",
                  THUMB,
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={it.thumb} alt={it.name} className="size-full object-cover" />
                {multi && (
                  <span className="absolute top-0.5 start-0.5 flex size-4 items-center justify-center rounded-full bg-gray-10/80 text-[10px] text-white">
                    {i + 1}
                  </span>
                )}
                {it.kind === "video" && (
                  <Play className="absolute inset-0 m-auto size-3.5 fill-white text-white drop-shadow" aria-hidden />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      <Button variant="outline" onClick={() => openDrivePicker(format)} className="w-full gap-2">
        <DriveMark />
        מדיה משלכם מ Google Drive
      </Button>
      <p className="text-xs-body text-text-neutral-default">
        {f.status === "connected"
          ? `מתיקיית „${f.name}” · ${f.items.length} קבצים`
          : f.status === "error"
            ? "אין גישה לתיקייה שחוברה — אפשר לתקן בהגדרות"
            : "עוד לא חוברה תיקייה ל" + FOLDER_META[k].label}
      </p>
    </div>
  )
}

/* ================================================================ the picker */

/**
 * ONE shape for everything in this flow (Hani): a 4:5 portrait. Tiles,
 * skeletons, slots, tray, result previews and Settings thumbnails all use it,
 * so a picture never changes shape between where it's chosen and where it
 * lands.
 */
const TILE = "aspect-[4/5]"
/** Small 4:5 thumbnail — 40×50. */
const THUMB = "h-[50px] w-10"

function Tile({
  item,
  format,
  selected,
  badge,
  onClick,
  disabled,
}: {
  item: MediaItem
  format: string
  selected: boolean
  badge?: number
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={`${item.name}${item.duration ? `, ${item.duration}` : ""}${badge ? ` — במקום ${badge}` : ""}`}
      className={cn(
        "group relative overflow-hidden rounded-xl bg-gray-90 text-start transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 disabled:cursor-default dark:bg-gray-20",
        TILE,
        selected ? "ring-2 ring-yellow-50" : "hover:ring-2 hover:ring-gray-80",
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={item.thumb} alt="" className="size-full object-cover" loading="lazy" />
      {item.kind === "video" && (
        // Logical `end` — the badge itself must not carry dir="ltr", or "end"
        // flips to the right and lands on the selection badge.
        <span className="absolute top-2 end-2 inline-flex items-center gap-1 rounded-md bg-gray-10/70 px-1.5 py-0.5 text-[11px] text-white">
          <span dir="ltr">{item.duration}</span>
          <Play className="size-2.5 fill-white" aria-hidden />
        </span>
      )}
      {badge !== undefined && (
        <span
          className={cn(
            "absolute top-2 start-2 flex size-6 items-center justify-center rounded-full border-2 text-xs font-semibold",
            badge > 0
              ? "border-yellow-50 bg-yellow-50 text-gray-10"
              : "border-white bg-gray-10/30 text-transparent",
          )}
          aria-hidden
        >
          {badge > 0 ? badge : ""}
        </span>
      )}
      {selected && badge === undefined && (
        <span className="absolute top-2 start-2 flex size-6 items-center justify-center rounded-full bg-yellow-50 text-gray-10" aria-hidden>
          <Check className="size-3.5" />
        </span>
      )}
      <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/60 to-transparent px-2.5 pb-2 pt-6 text-xs font-medium text-white">
        {item.name}
      </span>
    </button>
  )
}

function GridSkeleton({ format }: { format: string }) {
  return (
    <div className={cn("grid gap-3", "grid-cols-3")} role="status" aria-label="טוענים את התיקייה">
      {Array.from({ length: 9 }).map((_, i) => (
        <div
          key={i}
          className={cn("animate-pulse rounded-xl bg-gray-90 dark:bg-gray-20", TILE)}
        />
      ))}
    </div>
  )
}

/**
 * The panel, swapped. The back chevron lives in the panel header (as it does
 * for the avatars); Escape does the same.
 */
export function DriveFolderPicker({
  format,
  variant,
  scriptText,
}: {
  format: string
  variant: DrivePickVariant
  /** The format's script — A shows each slide's words on its slot. */
  scriptText: string
}) {
  const s = useDrivePickStore()
  const k = FORMAT_FOLDER[format] ?? "images"
  const f = s.folders[k]
  const meta = FOLDER_META[k]

  // Opening the folder takes a moment in real life (the server lists it).
  const [opening, setOpening] = useState(true)
  useEffect(() => {
    const t = setTimeout(() => setOpening(false), 650)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !s.importing) closeDrivePicker()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [s.importing])

  const loading = opening || s.forceLoading || f.status === "checking"

  return (
    <div className="flex min-h-full flex-col gap-4">
      {/* Folder line */}
      <div className="flex items-center gap-2">
        <DriveMark />
        <span className="truncate text-small-bold text-text-primary-default">
          {f.status === "connected" ? f.name : `תיקייה ל${meta.label}`}
        </span>
        {f.status === "connected" && !loading && (
          <span className="shrink-0 text-xs-body text-text-neutral-default">· {f.items.length} קבצים</span>
        )}
        {f.status === "connected" && (
          <span className="ms-auto flex shrink-0 items-center">
            <button
              type="button"
              onClick={() => {
                setOpening(true)
                setTimeout(() => setOpening(false), 650)
              }}
              aria-label="רענון התיקייה"
              title="רענון — לקבצים שהוספתם עכשיו לדרייב"
              className="inline-flex size-7 items-center justify-center rounded-md text-text-neutral-default transition-colors hover:bg-bg-surface-hover hover:text-text-primary-default"
            >
              <RefreshCw className="size-3.5" />
            </button>
            <a
              href={f.link}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="פתיחה בדרייב"
              title="פתיחה בדרייב"
              className="inline-flex size-7 items-center justify-center rounded-md text-text-neutral-default transition-colors hover:bg-bg-surface-hover hover:text-text-primary-default"
            >
              <ExternalLink className="size-3.5" />
            </a>
          </span>
        )}
      </div>

      {loading ? (
        <GridSkeleton format={format} />
      ) : f.status === "unset" ? (
        <NoFolder variant={variant} folderKey={k} />
      ) : f.status === "error" ? (
        <NoAccess variant={variant} folderKey={k} />
      ) : f.items.length === 0 ? (
        <div role="status" className="flex flex-col items-center gap-2 rounded-xl border border-border-neutral-default bg-bg-surface px-6 py-8 text-center">
          <FolderOpen className="size-6 text-text-neutral-default" aria-hidden />
          <p className="text-small-bold text-text-primary-default">התיקייה ריקה</p>
          <p className="text-xs-body text-text-neutral-default">
            העלו לתיקייה „{f.name}” בדרייב {meta.kindLabel}, ולחצו על רענון.
          </p>
          <a
            href={f.link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-small font-semibold text-text-primary-default hover:underline"
          >
            לתיקייה בדרייב ←
          </a>
        </div>
      ) : format === "carousel" || format === "story" ? (
        variant === "a" ? (
          <SlotFirstPicker format={format} items={f.items} scriptText={scriptText} />
        ) : (
          <OrderFirstPicker format={format} items={f.items} scriptText={scriptText} />
        )
      ) : variant === "a" ? (
        <SinglePickInstant format={format} items={f.items} />
      ) : (
        <SinglePickConfirm format={format} items={f.items} />
      )}
    </div>
  )
}

function NoFolder({ variant, folderKey }: { variant: DrivePickVariant; folderKey: FolderKey }) {
  const meta = FOLDER_META[folderKey]
  if (variant === "a") {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-border-neutral-default bg-bg-surface px-6 py-8 text-center">
        <FolderOpen className="size-6 text-text-neutral-default" aria-hidden />
        <p className="text-small-bold text-text-primary-default">עוד לא חיברתם תיקייה ל{meta.label}</p>
        <p className="text-xs-body text-text-neutral-default">
          מחברים פעם אחת בהגדרות, ומאז כל מה שבתיקייה מופיע כאן לבחירה.
        </p>
        <a
          href="/settings?tab=media&sub=drive&drivepick=a"
          className="mt-1 text-small font-semibold text-text-primary-default hover:underline"
        >
          לחיבור תיקייה בהגדרות ←
        </a>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border-neutral-default p-4">
      <p className="text-small-bold text-text-primary-default">חברו תיקייה ל{meta.label}</p>
      <p className="text-xs-body text-text-neutral-default">
        הדביקו כאן קישור לתיקייה בדרייב. היא תישמר גם בהגדרות, ובפעם הבאה תיפתח ישר.
      </p>
      <FolderLinkField folderKey={folderKey} autoFocus />
    </div>
  )
}

function NoAccess({ variant, folderKey }: { variant: DrivePickVariant; folderKey: FolderKey }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border-neutral-default p-4">
      {/* B's field carries the same error under it — once is enough. */}
      {variant === "a" && <ErrorBlock error="not_public" />}
      {variant === "a" ? (
        <a
          href="/settings?tab=media&sub=drive&drivepick=a"
          className="self-start text-small font-semibold text-text-primary-default hover:underline"
        >
          לתיקון בהגדרות ←
        </a>
      ) : (
        <FolderLinkField folderKey={folderKey} />
      )}
    </div>
  )
}

/** Footer stuck to the bottom of the panel's scroll area. */
function StickyFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky -bottom-6 z-10 -mx-6 -mb-6 mt-auto flex flex-col gap-2 border-t border-border-neutral-default bg-white px-6 py-4 dark:bg-gray-10">
      {children}
    </div>
  )
}

function ImportingLine() {
  const s = useDrivePickStore()
  return (
    <p className="flex items-center gap-2 text-xs text-text-neutral-default" role="status">
      <Loader2 className="size-3.5 animate-spin" aria-hidden />
      {s.importProgress}
    </p>
  )
}

/* ---------------------------------------------- single-frame formats */

/** A — one tap picks, like the avatar grid. */
function SinglePickInstant({ format, items }: { format: string; items: MediaItem[] }) {
  const s = useDrivePickStore()
  const busy = s.importing === format
  const [chosen, setChosen] = useState<string | null>(null)
  return (
    <>
      <p className="text-xs-body text-text-neutral-default">
        {items[0]?.kind === "video" ? "לחצו על סרטון כדי להשתמש בו." : "לחצו על תמונה כדי להשתמש בה."}
      </p>
      <div className={cn("grid gap-3", "grid-cols-3")}>
        {items.map((it) => (
          <Tile
            key={it.id}
            item={it}
            format={format}
            selected={chosen === it.id}
            disabled={busy}
            onClick={() => {
              setChosen(it.id)
              runImport(format, [it])
            }}
          />
        ))}
      </div>
      {busy && (
        <StickyFooter>
          <ImportingLine />
        </StickyFooter>
      )}
    </>
  )
}

/** B — select, look, then confirm in the tray. */
function SinglePickConfirm({ format, items }: { format: string; items: MediaItem[] }) {
  const s = useDrivePickStore()
  const busy = s.importing === format
  const [chosen, setChosen] = useState<string | null>(null)
  const item = items.find((i) => i.id === chosen) ?? null
  const isVideo = items[0]?.kind === "video"
  return (
    <>
      <p className="text-xs-body text-text-neutral-default">
        {isVideo ? "בחרו סרטון ואשרו למטה." : "בחרו תמונה ואשרו למטה."}
      </p>
      <div className={cn("grid gap-3", "grid-cols-3")}>
        {items.map((it) => (
          <Tile
            key={it.id}
            item={it}
            format={format}
            selected={chosen === it.id}
            disabled={busy}
            onClick={() => setChosen(chosen === it.id ? null : it.id)}
          />
        ))}
      </div>
      <StickyFooter>
        {busy ? (
          <ImportingLine />
        ) : (
          <div className="flex items-center gap-3">
            {item ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.thumb} alt="" className="h-[50px] w-10 shrink-0 rounded-lg object-cover" />
            ) : (
              <span className="h-[50px] w-10 shrink-0 rounded-lg border border-dashed border-border-neutral-default" aria-hidden />
            )}
            <span className="min-w-0 flex-1 truncate text-xs-body text-text-neutral-default">
              {item ? item.name : isVideo ? "עוד לא נבחר סרטון" : "עוד לא נבחרה תמונה"}
            </span>
            <Button size="sm" disabled={!item} onClick={() => item && runImport(format, [item])}>
              {isVideo ? "שימוש בסרטון" : "שימוש בתמונה"}
            </Button>
          </div>
        )}
      </StickyFooter>
    </>
  )
}

/* ---------------------------------------------- multi-frame: A, slot first */

function useSlideTexts(format: string, scriptText: string): string[] {
  return useMemo(() => {
    if (format === "carousel") {
      const slides = parseTextToSlides(scriptText)
      if (slides.length > 0) return slides.map((sl) => (sl.title || sl.body || "").trim())
      return ["", "", "", "", ""]
    }
    // A story has no per-frame script; three frames is the usual shape.
    return ["", "", ""]
  }, [format, scriptText])
}

const MAX_FRAMES = 10

function SlotFirstPicker({ format, items, scriptText }: { format: string; items: MediaItem[]; scriptText: string }) {
  const s = useDrivePickStore()
  const busy = s.importing === format
  const texts = useSlideTexts(format, scriptText)
  const unit = format === "carousel" ? "שקופית" : "פריים"
  const [slots, setSlots] = useState<(string | null)[]>(() => {
    const prev = s.picked[format]
    const base: (string | null)[] = texts.map(() => null)
    prev?.forEach((it, i) => {
      if (i < base.length) base[i] = it.id
      else base.push(it.id)
    })
    return base
  })
  const [active, setActive] = useState(0)
  const byId = (id: string | null) => (id ? items.find((i) => i.id === id) ?? null : null)
  const filled = slots.filter(Boolean).length

  const fill = (id: string) => {
    const next = [...slots]
    next[active] = id
    setSlots(next)
    // Light up the next empty slot after this one, wrapping around.
    const order = [...next.keys()].map((i) => (active + 1 + i) % next.length)
    const nextEmpty = order.find((i) => !next[i])
    if (nextEmpty !== undefined) setActive(nextEmpty)
  }

  const activeText = texts[active]

  return (
    <>
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold text-text-primary-default">סדר ה{format === "carousel" ? "שקופיות" : "פריימים"}</p>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 py-1" role="listbox" aria-label={`סדר ה${unit}ות`}>
          {slots.map((id, i) => {
            const it = byId(id)
            return (
              <div key={i} className="relative shrink-0">
                <button
                  type="button"
                  role="option"
                  aria-selected={active === i}
                  onClick={() => setActive(i)}
                  disabled={busy}
                  aria-label={`${unit} ${i + 1}${it ? ` — ${it.name}` : " — ריקה"}`}
                  className={cn(
                    "relative flex items-center justify-center overflow-hidden rounded-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50",
                    THUMB,
                    it ? "bg-gray-90" : "border border-dashed border-border-neutral-default",
                    active === i ? "ring-2 ring-yellow-50 ring-offset-1 ring-offset-white dark:ring-offset-gray-10" : "hover:ring-2 hover:ring-gray-80",
                  )}
                >
                  {it ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.thumb} alt="" className="size-full object-cover" />
                  ) : (
                    <span className="text-xs text-text-neutral-default">{i + 1}</span>
                  )}
                  {it && (
                    <span className="absolute top-0.5 start-0.5 flex size-4 items-center justify-center rounded-full bg-gray-10/80 text-[10px] text-white">
                      {i + 1}
                    </span>
                  )}
                </button>
                {it && !busy && (
                  <button
                    type="button"
                    onClick={() => {
                      const next = [...slots]
                      next[i] = null
                      setSlots(next)
                      setActive(i)
                    }}
                    aria-label={`ניקוי ${unit} ${i + 1}`}
                    className="absolute top-0.5 end-0.5 flex size-4 items-center justify-center rounded-full bg-white/90 text-text-primary-default shadow-sm transition-colors hover:bg-bg-surface-hover dark:bg-gray-10/90"
                  >
                    <X className="size-2.5" />
                  </button>
                )}
              </div>
            )
          })}
          {slots.length < MAX_FRAMES && (
            <button
              type="button"
              onClick={() => {
                setSlots([...slots, null])
                setActive(slots.length)
              }}
              disabled={busy}
              aria-label={`הוספת ${unit}`}
              className={cn(
                "flex shrink-0 items-center justify-center rounded-lg text-text-neutral-default transition-colors hover:bg-bg-surface-hover",
                "h-[50px] w-8",
              )}
            >
              <Plus className="size-4" />
            </button>
          )}
        </div>
      </div>

      {/* What the active slot is for — the script already says what goes on it. */}
      <div className="rounded-xl bg-bg-surface px-3 py-2.5">
        <p className="text-xs font-semibold text-text-primary-default">
          בוחרים ל{unit} {active + 1}
          {format === "carousel" && active === 0 ? " (השער)" : ""}
        </p>
        {activeText ? (
          <p className="mt-0.5 line-clamp-2 text-xs-body text-text-neutral-default">„{activeText}”</p>
        ) : (
          <p className="mt-0.5 text-xs-body text-text-neutral-default">לחצו על {format === "carousel" ? "תמונה" : "תמונה או סרטון"} למטה.</p>
        )}
      </div>

      <div className={cn("grid gap-3", "grid-cols-3")}>
        {items.map((it) => {
          const at = slots.indexOf(it.id)
          return (
            <Tile
              key={it.id}
              item={it}
              format={format}
              selected={slots[active] === it.id}
              badge={at >= 0 ? at + 1 : undefined}
              disabled={busy}
              onClick={() => fill(it.id)}
            />
          )
        })}
      </div>

      <StickyFooter>
        {busy ? (
          <ImportingLine />
        ) : (
          <>
            {filled > 0 && filled < slots.length && (
              <p className="text-xs-body text-text-neutral-default">
                {slots.length - filled} {format === "carousel" ? "שקופיות ריקות ידולגו" : "פריימים ריקים ידולגו"}
              </p>
            )}
            <Button
              disabled={filled === 0}
              onClick={() =>
                runImport(
                  format,
                  slots.map(byId).filter((x): x is MediaItem => !!x),
                )
              }
              className="w-full"
            >
              {format === "carousel" ? `טעינת הקרוסלה (${filled} שקופיות)` : `טעינת הסטורי (${filled} פריימים)`}
            </Button>
          </>
        )}
      </StickyFooter>
    </>
  )
}

/* ---------------------------------------------- multi-frame: B, order first */

function OrderFirstPicker({ format, items, scriptText }: { format: string; items: MediaItem[]; scriptText: string }) {
  const s = useDrivePickStore()
  const busy = s.importing === format
  const texts = useSlideTexts(format, scriptText)
  const unit = format === "carousel" ? "שקופיות" : "פריימים"
  const [order, setOrder] = useState<string[]>(() => (s.picked[format] ?? []).map((i) => i.id))
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const byId = (id: string) => items.find((i) => i.id === id)

  const toggle = (id: string) => {
    if (order.includes(id)) setOrder(order.filter((x) => x !== id))
    else if (order.length < MAX_FRAMES) setOrder([...order, id])
  }
  const move = (from: number, to: number) => {
    if (from === to) return
    const next = [...order]
    const [m] = next.splice(from, 1)
    next.splice(to, 0, m)
    setOrder(next)
  }

  return (
    <>
      <p className="text-xs-body text-text-neutral-default">
        לחצו על ה{format === "carousel" ? "תמונות" : "תמונות והסרטונים"} לפי הסדר שבו הם יופיעו
        {format === "carousel" && texts.length > 0 ? ` · בסקריפט יש ${texts.length} שקופיות` : ""}.
      </p>

      <div className={cn("grid gap-3", "grid-cols-3")}>
        {items.map((it) => {
          const at = order.indexOf(it.id)
          return (
            <Tile
              key={it.id}
              item={it}
              format={format}
              selected={at >= 0}
              badge={at >= 0 ? at + 1 : 0}
              disabled={busy}
              onClick={() => toggle(it.id)}
            />
          )
        })}
      </div>

      <StickyFooter>
        {busy ? (
          <ImportingLine />
        ) : (
          <>
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-text-primary-default">
                הסדר שבחרתם {order.length > 0 && `(${order.length})`}
              </p>
              {order.length > 1 && <p className="text-xs-body text-text-neutral-default">גררו כדי לשנות סדר</p>}
            </div>
            {order.length === 0 ? (
              <p className="text-xs-body text-text-neutral-default">עוד לא נבחר כלום.</p>
            ) : (
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="list" aria-label="הסדר שבחרתם">
                {order.map((id, i) => {
                  const it = byId(id)
                  if (!it) return null
                  return (
                    <div
                      key={id}
                      role="listitem"
                      draggable
                      tabIndex={0}
                      aria-label={`${i + 1}. ${it.name} — גררו או השתמשו בחצים ימינה/שמאלה כדי לשנות את הסדר`}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", String(i))
                        e.dataTransfer.effectAllowed = "move"
                        setDragIndex(i)
                      }}
                      onDragEnd={() => {
                        setDragIndex(null)
                        setOverIndex(null)
                      }}
                      onDragOver={(e) => {
                        if (dragIndex === null) return
                        e.preventDefault()
                        setOverIndex(i)
                      }}
                      onDrop={(e) => {
                        e.preventDefault()
                        if (dragIndex !== null) move(dragIndex, i)
                        setDragIndex(null)
                        setOverIndex(null)
                      }}
                      onKeyDown={(e) => {
                        // RTL: the strip reads right-to-left, so "left" is later.
                        if (e.key === "ArrowLeft" && i < order.length - 1) {
                          e.preventDefault()
                          move(i, i + 1)
                        } else if (e.key === "ArrowRight" && i > 0) {
                          e.preventDefault()
                          move(i, i - 1)
                        }
                      }}
                      className={cn(
                        "relative shrink-0 cursor-grab overflow-hidden rounded-lg bg-gray-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 active:cursor-grabbing",
                        THUMB,
                        dragIndex === i && "opacity-50",
                        overIndex === i && dragIndex !== i && "ring-2 ring-gray-80",
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={it.thumb} alt="" className="pointer-events-none size-full object-cover" />
                      <span className="absolute top-0.5 start-0.5 flex size-4 items-center justify-center rounded-full bg-gray-10/80 text-[10px] text-white">
                        {i + 1}
                      </span>
                      <GripVertical className="absolute bottom-0.5 end-0.5 size-3 text-white drop-shadow" aria-hidden />
                    </div>
                  )
                })}
              </div>
            )}
            <Button
              disabled={order.length === 0}
              onClick={() => runImport(format, order.map(byId).filter((x): x is MediaItem => !!x))}
              className="w-full"
            >
              {format === "carousel" ? `טעינת הקרוסלה (${order.length} ${unit})` : `טעינת הסטורי (${order.length} ${unit})`}
            </Button>
          </>
        )}
      </StickyFooter>
    </>
  )
}
