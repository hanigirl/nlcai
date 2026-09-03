"use client"

import { useState } from "react"
import { RichBodyEditor } from "@/components/rich-body-editor"

// Preview + probe for the script editor's whitespace round-trip. Public on
// local dev only — see middleware. Shows the React value as JSON so the
// number of newlines can be read off exactly.
export default function RichBodyEditorPreview() {
  const [value, setValue] = useState("שורה ראשונה\n\nפסקה שנייה\nשורה בתוכה")
  const [mounted, setMounted] = useState(0)
  return (
    <div dir="rtl" className="mx-auto max-w-xl p-8 flex flex-col gap-4">
      <RichBodyEditor
        key={mounted}
        value={value}
        onChange={setValue}
        className="min-h-[160px] rounded-[10px] border border-border-neutral-default bg-white px-3 py-2 text-small leading-relaxed"
      />
      <button
        type="button"
        data-testid="remount"
        onClick={() => setMounted((m) => m + 1)}
        className="self-start rounded-md border px-3 py-1 text-small"
      >
        remount (simulate reload)
      </button>
      <pre data-testid="value" className="text-xs-body whitespace-pre-wrap break-all">{JSON.stringify(value)}</pre>
    </div>
  )
}
