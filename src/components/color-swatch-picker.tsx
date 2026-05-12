"use client"

import { useState, useRef, useEffect } from "react"
import { HexColorPicker } from "react-colorful"
import { userKey } from "@/lib/user-scoped-storage"

// Custom colour picker: clicking the swatch opens a popover with a real
// colour wheel (react-colorful) plus a row of recently-used colours.
// We commit (i.e. call onChange and push to recents) only when the popover
// closes, so dragging across the wheel previews locally but doesn't spam
// the expensive cover-regenerate downstream — same UX contract the native
// <input type="color"> had.

interface ColorSwatchPickerProps {
  value: string
  onChange: (color: string) => void
  userId: string | null
  label?: string
}

const STORAGE_KEY = "recentSwatchColors_v1"
const MAX_RECENT = 6

export function ColorSwatchPicker({ value, onChange, userId, label = "צבע" }: ColorSwatchPickerProps) {
  const [open, setOpen] = useState(false)
  const [recent, setRecent] = useState<string[]>([])
  // Local draft colour shown inside the popover and on the swatch while
  // the popover is open. Only flushed to the parent on close.
  const [draftColor, setDraftColor] = useState<string>(value)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const initialColorRef = useRef<string>(value)

  useEffect(() => {
    if (!userId) return
    try {
      const raw = localStorage.getItem(userKey(STORAGE_KEY, userId))
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) setRecent(parsed.filter((c) => typeof c === "string"))
      }
    } catch (err) {
      console.error("[color-swatch-picker][load-recent]", err)
    }
  }, [userId])

  const persistRecent = (color: string) => {
    if (!userId) return
    const lower = color.toLowerCase()
    const next = [color, ...recent.filter((c) => c.toLowerCase() !== lower)].slice(0, MAX_RECENT)
    setRecent(next)
    try {
      localStorage.setItem(userKey(STORAGE_KEY, userId), JSON.stringify(next))
    } catch (err) {
      console.error("[color-swatch-picker][save-recent]", err)
    }
  }

  // Close + commit. Push the final colour upstream and add to recents,
  // but only if it actually differs from where we started.
  const closeAndCommit = () => {
    setOpen(false)
    if (draftColor.toLowerCase() !== initialColorRef.current.toLowerCase()) {
      onChange(draftColor)
      persistRecent(draftColor)
    }
  }

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) closeAndCommit()
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draftColor, recent, userId])

  const handleOpen = () => {
    initialColorRef.current = value
    setDraftColor(value)
    setOpen(true)
  }

  // Quick-pick from history: commit immediately and close.
  const pickRecent = (color: string) => {
    setOpen(false)
    if (color.toLowerCase() !== initialColorRef.current.toLowerCase()) {
      onChange(color)
      persistRecent(color)
    }
  }

  const swatchPreview = open ? draftColor : value

  return (
    <div className="relative inline-flex items-center gap-2" ref={wrapperRef} dir="rtl">
      <span className="text-small text-text-primary-default">{label}</span>
      <button
        type="button"
        onClick={open ? closeAndCommit : handleOpen}
        className="size-7 rounded-full border border-border-neutral-default shrink-0 cursor-pointer transition-transform hover:scale-105"
        style={{ backgroundColor: swatchPreview }}
        aria-label={`${label}: ${swatchPreview}`}
      />
      {open && (
        <div className="absolute bottom-full mb-2 end-0 z-50 rounded-xl border border-border-neutral-default bg-white dark:bg-gray-10 p-3 shadow-lg flex flex-col gap-3">
          <HexColorPicker
            color={draftColor}
            onChange={setDraftColor}
            style={{ width: 200, height: 160 }}
          />
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-neutral-default">HEX</span>
            <input
              type="text"
              value={draftColor}
              onChange={(e) => {
                const v = e.target.value
                if (/^#[0-9a-fA-F]{0,6}$/.test(v)) setDraftColor(v)
              }}
              className="flex-1 h-7 px-2 rounded border border-border-neutral-default text-xs text-text-primary-default focus:outline-none focus:border-button-primary-default"
              dir="ltr"
            />
          </div>
          {recent.length > 0 && (
            <>
              <div className="h-px bg-border-neutral-default" />
              <div className="flex flex-col gap-1.5">
                <p className="text-xs text-text-neutral-default">צבעים אחרונים</p>
                <div className="flex flex-wrap gap-1.5">
                  {recent.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => pickRecent(c)}
                      className="size-6 rounded-full border border-border-neutral-default cursor-pointer transition-transform hover:scale-110"
                      style={{ backgroundColor: c }}
                      aria-label={c}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
