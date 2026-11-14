"use client"

import { formatTextTerms } from "@/lib/format-text-terms"
import { useQaFixes1112 } from "@/lib/use-scheduling-access"

/** `ft("הסקריפט")` → "טקסט הפורמט" for Hani + Nataliya until launch (lib/format-text-terms). */
export function useFormatTextTerms(): (text: string) => string {
  const on = useQaFixes1112() === true
  return (text: string) => formatTextTerms(text, on)
}
