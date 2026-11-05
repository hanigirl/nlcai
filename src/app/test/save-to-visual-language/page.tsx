"use client"

/**
 * State preview for the AI-edit chat's visual memory: the
 * "לשמור לשפה הוויזואלית שלי" chip and the note under a reply
 * (lib/visual-memory, components/visual-memory-note).
 *
 * Route: /test/save-to-visual-language[?state=<id>]
 * No param = every state side by side, each in a panel-width frame.
 * No fetches, no DB writes: the presentational views only, with sample text.
 */

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { ArrowUp } from "lucide-react"
import { SaveToVisualLanguageChipView, type ChipState } from "@/components/save-to-visual-language-chip"
import { VisualMemoryNoteView } from "@/components/visual-memory-note"
import type { MemoryOutcome } from "@/lib/visual-memory"

const CHIP_STATES: { id: ChipState; label: string }[] = [
  { id: "ready", label: "צ׳יפ מוכן (אחרי עריכה)" },
  { id: "saving", label: "בבדיקה ושמירה" },
  { id: "error", label: "שגיאה" },
]

const NOTE_STATES: { id: string; label: string; memory: MemoryOutcome }[] = [
  {
    id: "saved",
    label: "נשמר",
    memory: { kind: "saved", id: "x", summary: "המילים בבי-רול נכנסות אחת אחת, בקפיצה קטנה", scope: "b_roll" },
  },
  {
    id: "settings",
    label: "שייך להגדרות (להבא)",
    memory: { kind: "settings", topics: ["colors"], summary: "מעכשיו רקע ורוד בכל התמונות", lasting: true },
  },
  {
    id: "settings-once",
    label: "שייך להגדרות (רק בעריכה הזו)",
    memory: { kind: "settings", topics: ["colors"], summary: "רקע ורוד בתמונה הזו" },
  },
  {
    id: "settings-locked",
    label: "פונט נעול (קרוסלה)",
    memory: { kind: "settings", topics: ["fonts"], summary: "הכותרות בפונט Assistant", locked: true, format: "carousel" },
  },
  {
    id: "conflict",
    label: "סתירה להעדפה קודמת",
    memory: {
      kind: "conflict",
      previous: [{ id: "a", summary: "המילים בבי-רול נכנסות אחת אחת" }],
      proposal: { rule: "", summary_he: "כל הכיתוב בבי-רול נכנס בבת אחת", scope: "b_roll" },
    },
  },
  { id: "kept", label: "רק בעריכה הזו", memory: { kind: "kept", previous: ["המילים בבי-רול נכנסות אחת אחת"] } },
  { id: "undone", label: "בוטל", memory: { kind: "undone", summary: "" } },
  { id: "none", label: "אין מה לשמור (מהצ׳יפ)", memory: { kind: "none", explicit: true } },
  { id: "error", label: "הבדיקה נכשלה", memory: { kind: "error", message: "" } },
]

function Composer({ children }: { children?: React.ReactNode }) {
  return (
    <div className="w-[380px] rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 shadow-xl">
      <div className="p-3">
        {children}
        <div className="flex items-end gap-2 rounded-[12px] border border-border-neutral-default p-2">
          <span className="flex-1 p-1 text-small text-text-neutral-default">מה תרצו לשנות?</span>
          <span className="inline-flex size-8 items-center justify-center rounded-full bg-button-primary-disabled">
            <ArrowUp className="size-4 text-text-primary-disabled" />
          </span>
        </div>
      </div>
    </div>
  )
}

function Reply({ memory }: { memory: MemoryOutcome }) {
  return (
    <div className="w-[380px] rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 p-4 shadow-xl">
      <div className="flex flex-col items-end gap-1.5">
        <div className="max-w-[85%] rounded-2xl rounded-se-sm bg-bg-surface px-3 py-2 text-small text-text-primary-default">
          עדכנתי את הבי-רול. הסרטון החדש מופיע בכרטיס.
        </div>
        <VisualMemoryNoteView memory={memory} className="max-w-[85%]" />
      </div>
    </div>
  )
}

function Inner() {
  const only = useSearchParams().get("state")
  const chips = CHIP_STATES.filter((s) => !only || s.id === only)
  const notes = NOTE_STATES.filter((s) => !only || s.id === only)
  return (
    <main dir="rtl" className="min-h-screen bg-bg-surface p-6">
      <h1 className="mb-6 text-small-bold text-text-primary-default">זיכרון ויזואלי בצ׳אט · מצבים</h1>
      <div className="flex flex-wrap gap-6">
        {chips.map((s) => (
          <section key={`chip-${s.id}`} className="space-y-2">
            <p className="text-xs-body text-text-neutral-default">צ׳יפ · {s.label}</p>
            <Composer>
              <SaveToVisualLanguageChipView state={s.id} onSave={() => undefined} />
            </Composer>
          </section>
        ))}
        {notes.map((s) => (
          <section key={`note-${s.id}`} className="space-y-2">
            <p className="text-xs-body text-text-neutral-default">הערה · {s.label}</p>
            <Reply memory={s.memory} />
          </section>
        ))}
      </div>
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
