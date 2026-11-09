"use client"

/**
 * State preview — "השפה הויזואלית שלך" with a language built on a photo of
 * her (Nataliya's bug, 2026-11-09: the AI invented faces).
 *
 * Route: /test/ai-own-photo?state=photo|nofolder|nophoto (no param = all three)
 * Renders the REAL new-panel pieces (MediaSourceChooser + the Drive entry)
 * for every format, with seeded Drive folders. Each format runs "המשך" once
 * on load so the outcome is on screen; the button runs it again (the next
 * photo). Nothing is fetched, generated, saved or imported.
 */

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { MediaSourceChooser } from "@/components/media-source-chooser"
import {
  DriveFolderEntry,
  importCreatorPhoto,
  setDrivePreviewState,
} from "@/components/drive-folder-review"

const STATES = ["photo", "nofolder", "nophoto"] as const
type State = (typeof STATES)[number]

const STATE_LABEL: Record<State, string> = {
  photo: "השפה שלך היא תמונה שלך, והתיקייה מחוברת — התמונה מגיעה מהתיקייה",
  nofolder: "השפה שלך היא תמונה שלך, אבל אין תיקייה — נוצר עם AI, בלי אף אדם בתמונה",
  nophoto: "השפה שלך בלי תמונה של אדם — נוצר עם AI כמו קודם",
}

const FORMATS = [
  { id: "carousel", label: "קרוסלה", aspect: "4/5" },
  { id: "image_post", label: "פוסט תמונה", aspect: "4/5" },
  { id: "story", label: "סטורי", aspect: "9/16" },
  { id: "b_roll", label: "בי-רול", aspect: "9/16" },
] as const

function FormatCard({ state, format }: { state: State; format: (typeof FORMATS)[number] }) {
  const [outcome, setOutcome] = useState<string | null>(null)
  const run = () => {
    void importCreatorPhoto(format.id, async () => state !== "nophoto").then((used) => {
      setOutcome(used ? null : "כאן רצה יצירה עם AI בשפה שלך — בלי אף אדם בתמונה.")
    })
  }
  // Once on load, after the Drive entry has registered its import.
  useEffect(() => {
    const t = setTimeout(run, 50)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex w-[400px] max-w-full flex-col gap-3 rounded-[20px] border border-border-neutral-default bg-bg-surface p-4">
      <p className="text-small-bold text-text-primary-default">{format.label}</p>
      <MediaSourceChooser
        format={format.id}
        brandTemplate={null}
        aspect={format.aspect}
        onExisting={() => {}}
        onAi={run}
      />
      {/* Her picked photo shows here; with no photo language nothing is picked. */}
      {state !== "nophoto" && <DriveFolderEntry format={format.id} statusOnly />}
      {outcome && <p className="text-xs-body text-text-neutral-default">{outcome}</p>}
    </div>
  )
}

function Section({ state }: { state: State }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-small-bold text-text-primary-default">{STATE_LABEL[state]}</h2>
      <div className="flex flex-wrap gap-4">
        {FORMATS.map((f) => (
          <FormatCard key={f.id} state={state} format={f} />
        ))}
      </div>
    </section>
  )
}

function Inner() {
  const params = useSearchParams()
  const raw = params.get("state")
  const only = raw && (STATES as readonly string[]).includes(raw) ? (raw as State) : null
  const [seeded, setSeeded] = useState(false)
  useEffect(() => {
    // One seeded folder set per page: "nofolder" has none connected.
    setDrivePreviewState(only === "nofolder" ? "nofolder" : "ready")
    setSeeded(true)
  }, [only])
  if (!seeded) return null
  // One folder set per page, so "all" shows the two states that share the
  // seeded folders; the no-folder state is its own link.
  const shown: State[] = only ? [only] : ["photo", "nophoto"]
  return (
    <main dir="rtl" className="flex min-h-screen flex-col gap-8 bg-white p-4 dark:bg-gray-10 sm:p-8">
      <h1 className="text-lg font-semibold text-text-primary-default">יצירה בשפה הויזואלית — התמונה שלך, לא פרצוף מומצא</h1>
      <nav className="flex flex-wrap gap-3 text-xs-body">
        {STATES.map((st) => (
          <a key={st} href={`?state=${st}`} className="text-text-primary-default underline">
            {STATE_LABEL[st].split(" — ")[1]}
          </a>
        ))}
      </nav>
      {shown.map((s) => (
        <Section key={s} state={s} />
      ))}
    </main>
  )
}

export default function Page() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  )
}
