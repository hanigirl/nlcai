"use client"

/**
 * State preview for the Drive media panel (b-roll / image post bug, 2026-10-22).
 *
 * Route: /test/drive-folder?format=b_roll|image_post&state=…
 * Renders the REAL panel pieces — the "מדיה משלכם מ Google Drive" entry and
 * the folder gallery it swaps in — inside a 400px frame like the one on
 * /project. Folders are seeded; nothing is fetched, saved or imported.
 */

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ChevronRight, Film, ImageIcon } from "lucide-react"
import {
  DriveFolderEntry,
  DriveFolderPicker,
  closeDrivePicker,
  openDrivePicker,
  setDrivePreviewState,
  useDrivePickStore,
  type DrivePreviewState,
} from "@/components/drive-folder-review"
import { cn } from "@/lib/utils"

const STATES = ["nofolder", "noaccess", "empty", "ready", "importing", "importerror"] as const
type State = (typeof STATES)[number]

const STATE_LABEL: Record<State, string> = {
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

const IMPORT_ERROR = "הקובץ לא ציבורי. שנו את ההרשאה ל„כל מי שיש לו הקישור” ונסו שוב."

function Inner() {
  const params = useSearchParams()
  const router = useRouter()
  const rawState = params.get("state") as State | null
  const state: State = rawState && (STATES as readonly string[]).includes(rawState) ? rawState : "nofolder"
  const format: Fmt = params.get("format") === "image_post" ? "image_post" : "b_roll"
  const s = useDrivePickStore()
  // The panel pieces mount only after the folders are seeded — otherwise
  // their own first load would reach the API before the seed lands.
  const [seeded, setSeeded] = useState(false)

  useEffect(() => {
    const folders: DrivePreviewState = state === "importing" || state === "importerror" ? "ready" : state
    setDrivePreviewState(folders)
    // The panel's empty / no-access / gallery states live in the swapped panel.
    if (state === "importing" || state === "importerror") closeDrivePicker()
    else openDrivePicker(format)
    setSeeded(true)
  }, [state, format])

  const go = (patch: Record<string, string>) => {
    const q = new URLSearchParams({ format, state, ...patch })
    router.replace(`/test/drive-folder?${q.toString()}`)
  }

  const meta = FORMATS[format]
  const Icon = meta.icon
  const pickerOpen = s.pickerFor === format

  return (
    <div dir="rtl" className="min-h-screen bg-bg-surface px-4 py-8">
      <div className="mx-auto flex max-w-[400px] flex-col gap-4">
        <div className="flex flex-col gap-2 rounded-xl border border-dashed border-border-neutral-default bg-white p-3 text-xs dark:bg-gray-10">
          <ToggleRow label="פורמט">
            {(Object.keys(FORMATS) as Fmt[]).map((f) => (
              <Chip key={f} on={format === f} onClick={() => go({ format: f })}>
                {FORMATS[f].label}
              </Chip>
            ))}
          </ToggleRow>
          <ToggleRow label="מצב">
            {STATES.map((st) => (
              <Chip key={st} on={state === st} onClick={() => go({ state: st })}>
                {STATE_LABEL[st]}
              </Chip>
            ))}
          </ToggleRow>
        </div>

        <div className="h-[720px] overflow-hidden rounded-xl border border-border-neutral-default bg-white dark:bg-gray-10">
          <div className="flex items-center gap-2 border-b border-border-neutral-default px-6 py-4">
            {pickerOpen && (
              <button
                type="button"
                onClick={closeDrivePicker}
                aria-label="חזרה"
                className="cursor-pointer rounded-lg p-0.5 transition-colors hover:bg-gray-95 dark:hover:bg-gray-20"
              >
                <ChevronRight className="size-4 text-text-neutral-default" />
              </button>
            )}
            <Icon className="size-4 text-text-neutral-default" aria-hidden />
            <span className="text-p-bold text-text-primary-default">{meta.label}</span>
          </div>
          <div className="h-[calc(100%-57px)] overflow-y-auto px-6 py-6">
            {!seeded ? null : pickerOpen ? (
              <DriveFolderPicker key={format} format={format} scriptText="" />
            ) : (
              <DriveFolderEntry
                format={format}
                onImport={() => {}}
                pulling={state === "importing"}
                error={state === "importerror" ? IMPORT_ERROR : null}
              />
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

export default function DriveFolderPreviewPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  )
}
