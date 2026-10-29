"use client"

/**
 * Review page for the Drive-media bug (b-roll / image post, 2026-10-22).
 *
 * Route: /test/drive-folder?drivefix=a|b&format=b_roll|image_post&state=…
 * Renders the REAL panel pieces — the "מדיה משלכם מ Google Drive" entry and
 * the folder picker it swaps in — inside a 400px panel frame like the one on
 * /project. Folders are seeded; nothing is fetched, saved or imported.
 *
 * The same ?drivefix=…&state=… also works on /project itself: open any post,
 * open the b-roll or image card.
 */

import { Suspense, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ChevronRight, Film, ImageIcon } from "lucide-react"
import {
  DRIVE_FIX_STATES,
  DriveFolderEntry,
  DriveFolderPicker,
  closeDrivePicker,
  openDrivePicker,
  readDriveFixParams,
  setDriveFixReview,
  useDrivePickStore,
  type DriveFixState,
} from "@/components/drive-folder-review"
import { cn } from "@/lib/utils"

const STATE_LABEL: Record<DriveFixState, string> = {
  nofolder: "אין תיקייה",
  noaccess: "אין גישה",
  empty: "תיקייה ריקה",
  ready: "תיקייה מלאה",
  importing: "בזמן ייבוא",
  importerror: "ייבוא נכשל",
}

const FORMATS = {
  b_roll: { label: "בי-רול", icon: Film },
  image_post: { label: "פוסט תמונה", icon: ImageIcon },
} as const
type Fmt = keyof typeof FORMATS

/** States where the reviewer should land inside the gallery, per direction. */
const OPEN_IN: Record<"a" | "b", DriveFixState[]> = {
  a: ["nofolder", "noaccess", "empty", "ready"],
  b: ["empty", "ready"],
}

function Inner() {
  const params = useSearchParams()
  const router = useRouter()
  const review = readDriveFixParams(params.toString()) ?? { variant: "b" as const, state: "nofolder" as const }
  const format: Fmt = params.get("format") === "image_post" ? "image_post" : "b_roll"
  const s = useDrivePickStore()

  useEffect(() => {
    setDriveFixReview(review)
    if (OPEN_IN[review.variant].includes(review.state)) openDrivePicker(format)
    else closeDrivePicker()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review.variant, review.state, format])

  const go = (patch: Record<string, string>) => {
    const q = new URLSearchParams({ drivefix: review.variant, format, state: review.state, ...patch })
    router.replace(`/test/drive-folder?${q.toString()}`)
  }

  const meta = FORMATS[format]
  const Icon = meta.icon
  const pickerOpen = s.pickerFor === format

  return (
    <div dir="rtl" className="min-h-screen bg-bg-surface px-4 py-8">
      <div className="mx-auto flex max-w-[400px] flex-col gap-4">
        {/* Review-only toggle */}
        <div className="flex flex-col gap-2 rounded-xl border border-dashed border-border-neutral-default bg-white p-3 text-xs dark:bg-gray-10">
          <ToggleRow label="כיוון">
            {(["a", "b"] as const).map((v) => (
              <Chip key={v} on={review.variant === v} onClick={() => go({ drivefix: v })}>
                {v === "a" ? "A · מצב ריק בגלריה" : "B · הכפתור מספר מראש"}
              </Chip>
            ))}
          </ToggleRow>
          <ToggleRow label="פורמט">
            {(Object.keys(FORMATS) as Fmt[]).map((f) => (
              <Chip key={f} on={format === f} onClick={() => go({ format: f })}>
                {FORMATS[f].label}
              </Chip>
            ))}
          </ToggleRow>
          <ToggleRow label="מצב">
            {DRIVE_FIX_STATES.map((st) => (
              <Chip key={st} on={review.state === st} onClick={() => go({ state: st })}>
                {STATE_LABEL[st]}
              </Chip>
            ))}
          </ToggleRow>
        </div>

        {/* The panel, as on /project */}
        <div className="h-[720px] overflow-hidden rounded-xl border border-border-neutral-default bg-white dark:bg-gray-10">
          <div className="flex items-center gap-2 border-b border-border-neutral-default px-6 py-4">
            {pickerOpen && (
              <button
                type="button"
                onClick={closeDrivePicker}
                aria-label="חזרה"
                className="cursor-pointer rounded-lg p-0.5 transition-colors hover:bg-bg-surface"
              >
                <ChevronRight className="size-4 text-text-neutral-default" />
              </button>
            )}
            <Icon className="size-4 text-text-neutral-default" aria-hidden />
            <span className="text-p-bold text-text-primary-default">{meta.label}</span>
          </div>
          <div className="h-[calc(100%-57px)] overflow-y-auto px-6 py-6">
            {pickerOpen ? (
              <DriveFolderPicker key={format} format={format} scriptText="" />
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex h-[150px] items-center justify-center rounded-[18px] border border-border-neutral-default text-xs-body text-text-neutral-default">
                  (יצירה עם AI — לא משתנה)
                </div>
                <div className="flex items-center gap-3" role="separator">
                  <span className="h-px flex-1 bg-border-neutral-default" />
                  <span className="text-xs text-text-neutral-default">או</span>
                  <span className="h-px flex-1 bg-border-neutral-default" />
                </div>
                <DriveFolderEntry format={format} onImport={() => {}} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ToggleRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-10 shrink-0 text-text-neutral-default">{label}</span>
      {children}
    </div>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "rounded-full border px-2.5 py-1 transition-colors",
        on
          ? "border-text-primary-default bg-text-primary-default text-white dark:text-gray-10"
          : "border-border-neutral-default text-text-primary-default hover:bg-gray-95 dark:hover:bg-gray-20",
      )}
    >
      {children}
    </button>
  )
}

export default function DriveFolderReviewPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  )
}
