"use client"

import { useAfterGenChoices } from "@/lib/use-scheduling-access"
import { formatTextTerms } from "@/lib/format-text-terms"

/** `ft("הסקריפט")` → "טקסט הפורמט" for Hani + Nataliya until launch (lib/format-text-terms). */
export function useFormatTextTerms(): (text: string) => string {
  // Hani only until she tests it live (2026-11-14).
  const on = useAfterGenChoices() === true
  return (text: string) => formatTextTerms(text, on)
}
