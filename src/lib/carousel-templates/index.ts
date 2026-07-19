import type { ReactNode } from "react"

export { SLIDE_SIZE } from "./shared"

export interface SlideData {
  slide: number
  type: "cover" | "content" | "cta"
  title: string
  body: string
}

/**
 * Canvas palette of the template, used by the picker to draw a pure-CSS
 * mini-mock thumbnail (no server render). Raw hex is fine here — this
 * describes canvas art, not app UI.
 */
export interface TemplatePreview {
  /** Content-slide background */
  bg: string
  /** Accent / brand color of the template */
  accent: string
  titleColor: string
  bodyColor: string
}

export interface TemplateConfig {
  id: string
  /** Hebrew display name shown in the picker */
  name: string
  preview: TemplatePreview
  /** Canvas size — defaults to 1080×1080. IG-portrait templates use 1080×1350. */
  size?: { width: number; height: number }
  /** Optional pre-rendered thumbnail (future — mini-mock is the default) */
  thumbnailUrl?: string
  /**
   * "satori" (default) — deterministic code render via `render`.
   * "ai" — gpt-image-2 paints the full slide (incl. Hebrew text) guided
   * by `aiStyleSpec`; served by /api/carousel/generate-ai (BYOK OpenAI).
   */
  kind?: "satori" | "ai"
  /** Render a single slide as React elements (satori templates only) */
  render?: (
    slide: SlideData,
    slideIndex: number,
    totalSlides: number,
  ) => ReactNode
  /**
   * AI templates only — the locked art-direction block injected into every
   * slide prompt so all slides of one carousel share a design system.
   */
  aiStyleSpec?: string
}

// Template registry — import and register templates here
import { aiDarkTemplate, aiLightTemplate } from "./ai"

// Per Hani 2026-07-09 (night): ONLY dark + light for now — both gpt-image-2
// with one shared design language (carousel-design skill), differing only
// in palette/mood. Benched, files kept for easy restore: aiVibrantTemplate
// + aiNeonTemplate (./ai) and the satori templates (default, urban, soft,
// vibrant, bold).
export const CAROUSEL_TEMPLATES: TemplateConfig[] = [
  aiDarkTemplate,
  aiLightTemplate,
]

export function getTemplate(id: string): TemplateConfig | undefined {
  return CAROUSEL_TEMPLATES.find((t) => t.id === id)
}
