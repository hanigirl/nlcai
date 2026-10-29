"use client"

/**
 * Media from her Google Drive folders (Hani, 2026-10-22).
 *
 * Settings → מדיה → "מדיה מ-Google Drive": one shared folder per kind of
 * media (b-roll, talking head, images, story, carousel), each in an accordion
 * row, view-only links. On the canvas, "מדיה משלכם מ Google Drive" in a
 * format's media panel swaps the panel for a gallery of that folder.
 * Multi-frame formats (carousel, story): tap pictures in the order they
 * should appear, rearrange in the tray. Single-file formats: select, confirm.
 *
 * The folders are listed live by /api/drive-folders. A pick hands the chosen
 * files, as Drive file links in order, to the import each format already had
 * — the picker replaces the typing, not the pipeline.
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ExternalLink,
  FolderOpen,
  GripVertical,
  Loader2,
  Play,
  RefreshCw,
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
  /** What lands on the canvas card: the clip for a video, the picture otherwise. */
  src: string
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
  /** The format last worked on — the review bar keeps pointing at it after
   *  a pick closes the panel. */
  lastFormat: string | null
}

/* ================================================================ seed */

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

const unset = (): Folder => ({ status: "unset", link: "", name: "", items: [], error: null, editorLink: false })
/** "קובץ אחד" / "3 קבצים". */
const filesLabel = (n: number) => (n === 1 ? "קובץ אחד" : `${n} קבצים`)

/** "שקופית אחת" / "3 שקופיות", "פריים אחד" / "3 פריימים". */
const countLabel = (format: string, n: number) =>
  format === "carousel"
    ? n === 1 ? "שקופית אחת" : `${n} שקופיות`
    : n === 1 ? "פריים אחד" : `${n} פריימים`

/* ================================================================ store */

let store: Store = {
  folders: Object.fromEntries(FOLDER_ORDER.map((k) => [k, unset()])) as Record<FolderKey, Folder>,
  pickerFor: null,
  forceLoading: false,
  picked: {},
  importing: null,
  importProgress: "",
  lastFormat: null,
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

/** The picker's direction — B (pick in order) was chosen (Hani, 2026-10-22). */
export function useDrivePickVariant(): DrivePickVariant {
  return "b"
}

export function openDrivePicker(format: string) {
  set({ pickerFor: format, lastFormat: format })
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

type ApiItem = { id: string; name: string; kind: "image" | "video"; thumb?: string }
type ApiFolder = { link: string; name: string; items: ApiItem[] } | { link: string; error: FolderError }

/** A Drive file as the picker shows it: Drive's own thumbnail, its file link as the source. */
const toItem = (it: ApiItem): MediaItem => ({
  id: it.id,
  name: it.name,
  kind: it.kind,
  // Drive's public thumbnail by file id — videos included. Not
  // drive.google.com/thumbnail (needs a Google session in the browser) and not
  // the folder view's own image URL (refused when our page is the referrer).
  thumb: `https://lh3.googleusercontent.com/d/${it.id}=w400`,
  src: `https://drive.google.com/file/d/${it.id}/view`,
})

const fromApi = (f: ApiFolder | null): Folder =>
  !f
    ? unset()
    : "error" in f
      ? { ...unset(), status: "error", link: f.link, error: f.error }
      : { status: "connected", link: f.link, name: f.name, items: f.items.map(toItem), error: null, editorLink: false }

let loadedOnce: Promise<void> | null = null

/* ---------------------------------------------- state preview (/test only) */

/**
 * /test/drive-folder renders the real panel pieces in each state. It seeds the
 * folders here and switches every request off: no listing, no save, no
 * import. Nothing in the app calls this.
 */
let previewOnly = false
export type DrivePreviewState = "nofolder" | "noaccess" | "empty" | "ready"
const PREVIEW_THUMBS = ["/images/onboarding-hero.png", "/images/idea.png", "/images/hook.png", "/images/letter.png", "/images/calendar-min.png", "/images/paper-plane-celebrate.png"]
function previewFolder(k: FolderKey, state: DrivePreviewState): Folder {
  const link = "https://drive.google.com/drive/folders/sample-folder"
  if (state === "nofolder") return unset()
  if (state === "noaccess") return { ...unset(), status: "error", link, error: "not_public" }
  const video = k === "broll" || k === "talking"
  const items: MediaItem[] =
    state === "empty"
      ? []
      : PREVIEW_THUMBS.map((thumb, i) => ({
          id: `sample-${k}-${i}`,
          name: video ? `clip-${i + 1}.mp4` : `photo-${i + 1}.jpg`,
          kind: video ? "video" : "image",
          ...(video ? { duration: `0:${String(8 + i * 3).padStart(2, "0")}` } : {}),
          thumb,
          src: `https://drive.google.com/file/d/sample-${k}-${i}/view`,
        }))
  return { status: "connected", link, name: FOLDER_META[k].driveName, items, error: null, editorLink: false }
}
export function setDrivePreviewState(state: DrivePreviewState) {
  previewOnly = true
  loadedOnce = Promise.resolve()
  const folders = Object.fromEntries(FOLDER_ORDER.map((k) => [k, previewFolder(k, state)])) as Record<FolderKey, Folder>
  set({ folders, picked: {}, importing: null, importProgress: "" })
}

/** Her saved folders, listed live. Once per page load; `force` re-reads. */
export function loadDriveFolders(force = false): Promise<void> {
  if (loadedOnce && !force) return loadedOnce
  FOLDER_ORDER.forEach((k) => {
    if (store.folders[k].status === "unset") setFolder(k, { status: "checking" })
  })
  loadedOnce = fetch("/api/drive-folders")
    .then((r) => r.json())
    .then((d: { folders?: Record<FolderKey, ApiFolder | null> }) => {
      const next = { ...store.folders }
      for (const k of FOLDER_ORDER) next[k] = fromApi(d.folders?.[k] ?? null)
      set({ folders: next })
    })
    .catch(() => {
      FOLDER_ORDER.forEach((k) => {
        if (store.folders[k].status === "checking") setFolder(k, unset())
      })
      loadedOnce = null
    })
  return loadedOnce
}

/**
 * Re-read one folder from the server — opening the picker shows what's in
 * Drive NOW, and what's saved NOW.
 *
 * Bug (2026-10-22, Nataliya): this used to return early unless the folder was
 * already "connected" in this page's memory. The folders are read once per
 * page load, so a folder connected after that (Settings in another tab, on
 * another device, or a first load that failed) stayed "not connected" here
 * for the rest of the session — the panel asked her to connect a folder she
 * had already set. Every open, and every return to the tab, now asks the
 * server. Skipped only while a connect is in flight, so an older answer
 * can't overwrite the one being saved.
 */
export async function refreshDriveFolder(k: FolderKey): Promise<void> {
  if (previewOnly || store.folders[k].status === "checking") return
  try {
    const d = (await fetch(`/api/drive-folders?key=${k}`).then((r) => r.json())) as { folder?: ApiFolder | null }
    if (d.folder !== undefined && (store.folders[k].status as Folder["status"]) !== "checking") setFolder(k, fromApi(d.folder))
  } catch {
    // Keep what we had; the gallery still works from the last listing.
  }
}

export async function connectFolder(k: FolderKey, link: string) {
  if (previewOnly) {
    if (link.trim()) setFolder(k, previewFolder(k, "ready"))
    return
  }
  if (!link.trim()) {
    setFolder(k, unset())
    return
  }
  setFolder(k, { status: "checking", link, error: null })
  try {
    const d = (await fetch("/api/drive-folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: k, link }),
    }).then((r) => r.json())) as { folder?: ApiFolder; error?: FolderError }
    if (d.folder) setFolder(k, fromApi(d.folder))
    else setFolder(k, { status: "error", error: d.error ?? "not_public", items: [], name: "" })
  } catch {
    setFolder(k, { status: "error", error: "not_public", items: [], name: "" })
  }
}

export function disconnectFolder(k: FolderKey) {
  setFolder(k, unset())
  if (previewOnly) return
  void fetch("/api/drive-folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: k, link: "" }),
  })
}

/**
 * Each format's panel registers the import it already has (the carousel's
 * Drive import, the story's, the image / b-roll / talking-head link pull).
 * A pick hands it the chosen files as Drive file links, in order — exactly
 * what she used to paste row by row — so captions, saving and the canvas
 * card all work the way they always have.
 */
const importers = new Map<string, (links: string[]) => void>()
export function registerDriveImporter(format: string, fn: ((links: string[]) => void) | null) {
  if (fn) importers.set(format, fn)
  else importers.delete(format)
}

/* ------------------------------------------------- simulated import */

function runImport(format: string, items: MediaItem[]) {
  if (items.length === 0) return
  if (previewOnly) {
    set({ picked: { ...store.picked, [format]: items }, pickerFor: null })
    return
  }
  const importer = importers.get(format)
  if (!importer) return
  set({ picked: { ...store.picked, [format]: items }, pickerFor: null })
  importer(items.map((it) => it.src))
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
  useEffect(() => {
    void loadDriveFolders()
  }, [])
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

function FolderSummary({ f, folderKey }: { f: Folder; folderKey: FolderKey }) {
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
          <img key={it.id} src={it.thumb} alt="" className={cn("rounded-[4px] border border-white object-cover dark:border-gray-10", miniFor(FOLDER_FORMAT[folderKey]))} />
        ))}
      </span>
      {filesLabel(f.items.length)}
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
          <FolderSummary f={f} folderKey={folderKey} />
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
              <span className="text-xs-body text-text-neutral-default">· {filesLabel(f.items.length)}</span>
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
                  <div key={it.id} className={cn("relative shrink-0 overflow-hidden rounded-lg bg-gray-90", thumbFor(FOLDER_FORMAT[folderKey]))}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={it.thumb} alt={it.name} className="size-full object-cover" />
                    {it.kind === "video" && (
                      <Play className="absolute inset-0 m-auto size-3.5 fill-white text-white drop-shadow" aria-hidden />
                    )}
                  </div>
                ))}
                {f.items.length > 6 && (
                  <span className={cn("flex shrink-0 items-center justify-center rounded-lg bg-gray-90 text-xs text-text-neutral-default dark:bg-gray-20", thumbFor(FOLDER_FORMAT[folderKey]))}>
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
export function DriveFolderEntry({
  format,
  onImport,
  pulling,
  error,
}: {
  format: string
  /** The format's own Drive import — receives the picked files' links, in order. */
  onImport?: (links: string[]) => void
  /** The import after a pick is still running (the panel's own Drive pull). */
  pulling?: boolean
  /** The import after a pick failed — shown here, where she picked. Before
   *  this, the picker closed and a failed pull said nothing at all. */
  error?: string | null
}) {
  const s = useDrivePickStore()
  const k = FORMAT_FOLDER[format] ?? "images"
  useEffect(() => {
    void loadDriveFolders()
  }, [])
  // Kept current every render: the import closes over the panel's latest state.
  const importRef = useRef(onImport)
  useEffect(() => {
    importRef.current = onImport
  })
  useEffect(() => {
    registerDriveImporter(format, (links) => importRef.current?.(links))
    return () => registerDriveImporter(format, null)
  }, [format])
  // Back from Drive / Settings in another tab: re-read, so a folder she just
  // connected or re-shared is there without a reload.
  useRefreshOnFocus(k)
  const f = s.folders[k]
  const picked = s.picked[format]
  const multi = format === "carousel" || format === "story"

  return (
    <div className="flex flex-col gap-2">
      {picked && picked.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-border-neutral-default p-3">
          <p className="text-xs-body text-text-neutral-default">
            {multi
              ? `נבחרו ${countLabel(format, picked.length)} מהתיקייה, לפי הסדר:`
              : "נבחר מהתיקייה:"}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {picked.map((it, i) => (
              <div
                key={`${it.id}-${i}`}
                className={cn(
                  "relative shrink-0 overflow-hidden rounded-lg bg-gray-90",
                  thumbFor(format),
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
      <Button variant="outline" onClick={() => openDrivePicker(format)} disabled={!!pulling} className="w-full gap-2">
        <DriveMark />
        מדיה משלכם מ Google Drive
      </Button>
      {pulling ? (
        <p className="flex items-center gap-2 text-xs text-text-neutral-default" role="status">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          מחברים את המדיה מהדרייב...
        </p>
      ) : error ? (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-button-destructive-default">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : (
        <p className="text-xs-body text-text-neutral-default">
          {f.status === "connected"
            ? `מתיקיית „${f.name}” · ${filesLabel(f.items.length)}`
            : f.status === "error"
              ? "אין גישה לתיקייה שחוברה — אפשר לתקן כאן"
              : "עוד לא חוברה תיקייה ל" + FOLDER_META[k].label}
        </p>
      )}
    </div>
  )
}

function useRefreshOnFocus(k: FolderKey) {
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === "visible") void refreshDriveFolder(k)
    }
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onFocus)
    return () => {
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onFocus)
    }
  }, [k])
}

/* ================================================================ the picker */

/**
 * Every preview takes the shape of its FORMAT (Hani): an image post or a
 * carousel slide is a 4:5 portrait, a story / b-roll / talking head is 9:16.
 * Never square. Tiles, skeletons, slots, tray, result previews and Settings
 * thumbnails all follow it, so a picture keeps its shape from where it's
 * chosen to where it lands.
 */
const TALL_FORMATS = new Set(["story", "b_roll", "talking_head"])
const FOLDER_FORMAT: Record<FolderKey, string> = {
  broll: "b_roll",
  talking: "talking_head",
  images: "image_post",
  story: "story",
  carousel: "carousel",
}
const tileFor = (format: string) =>
  TALL_FORMATS.has(format) ? "aspect-[9/16]" : "aspect-[4/5]"
/** Small thumbnail — 40×50 (4:5) or 36×64 (9:16). */
const thumbFor = (format: string) =>
  TALL_FORMATS.has(format) ? "h-16 w-9" : "h-[50px] w-10"
/** The tiny stacked thumbnails in a folder row's summary. */
const miniFor = (format: string) =>
  TALL_FORMATS.has(format) ? "h-6 w-[14px]" : "h-5 w-4"

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
        tileFor(format),
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
          className={cn("animate-pulse rounded-xl bg-gray-90 dark:bg-gray-20", tileFor(format))}
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
  scriptText,
}: {
  format: string
  /** The format's script — A shows each slide's words on its slot. */
  scriptText: string
}) {
  const s = useDrivePickStore()
  const k = FORMAT_FOLDER[format] ?? "images"
  const f = s.folders[k]
  const meta = FOLDER_META[k]

  useRefreshOnFocus(k)
  // Opening re-lists the folder, so a file she just dropped into Drive is there.
  const [opening, setOpening] = useState(true)
  useEffect(() => {
    let alive = true
    void loadDriveFolders()
      .then(() => refreshDriveFolder(k))
      .finally(() => alive && setOpening(false))
    return () => {
      alive = false
    }
  }, [k])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !s.importing) closeDrivePicker()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [s.importing])

  const loading = opening || f.status === "checking"

  return (
    <div className="flex min-h-full flex-col gap-4">
      {/* Folder line */}
      <div className="flex items-center gap-2">
        <DriveMark />
        <span className="truncate text-small-bold text-text-primary-default">
          {f.status === "connected" ? f.name : `תיקייה ל${meta.label}`}
        </span>
        {f.status === "connected" && !loading && (
          <span className="shrink-0 text-xs-body text-text-neutral-default">· {filesLabel(f.items.length)}</span>
        )}
        {f.status === "connected" && (
          <span className="ms-auto flex shrink-0 items-center">
            <button
              type="button"
              onClick={() => {
                // A real re-read (it used to only flash the skeleton).
                setOpening(true)
                void refreshDriveFolder(k).finally(() => setOpening(false))
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
        <NoFolder folderKey={k} />
      ) : f.status === "error" ? (
        <NoAccess folderKey={k} />
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
        <OrderFirstPicker format={format} items={f.items} scriptText={scriptText} />
      ) : (
        <SinglePickConfirm format={format} items={f.items} />
      )}
    </div>
  )
}

function NoFolder({ folderKey }: { folderKey: FolderKey }) {
  const meta = FOLDER_META[folderKey]
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border-neutral-default p-4">
      <p className="text-small-bold text-text-primary-default">עוד לא חוברה תיקייה ל{meta.label}</p>
      <p className="text-xs-body text-text-neutral-default">
        הדביקו כאן קישור לתיקייה בדרייב. היא תישמר גם בהגדרות, ובפעם הבאה תיפתח ישר.
      </p>
      <FolderLinkField folderKey={folderKey} autoFocus />
    </div>
  )
}

function NoAccess({ folderKey }: { folderKey: FolderKey }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border-neutral-default p-4">
      {/* The field carries the error and its fix under it. */}
      <FolderLinkField folderKey={folderKey} />
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

function OrderFirstPicker({ format, items, scriptText }: { format: string; items: MediaItem[]; scriptText: string }) {
  const s = useDrivePickStore()
  const busy = s.importing === format
  const texts = useSlideTexts(format, scriptText)
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
                        thumbFor(format),
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
              {format === "carousel" ? `טעינת הקרוסלה (${countLabel(format, order.length)})` : `טעינת הסטורי (${countLabel(format, order.length)})`}
            </Button>
          </>
        )}
      </StickyFooter>
    </>
  )
}
