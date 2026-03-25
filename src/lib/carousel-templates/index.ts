import type { ReactNode } from "react"

export interface SlideData {
  slide: number
  type: "cover" | "content" | "cta"
  title: string
  body: string
}

export interface TemplateConfig {
  id: string
  name: string
  /** Background color for template preview thumbnail */
  previewBg: string
  /** Render a single slide as React elements (for satori) */
  render: (
    slide: SlideData,
    slideIndex: number,
    totalSlides: number,
  ) => ReactNode
}

// Template registry — import and register templates here
import { defaultTemplate } from "./default"

export const CAROUSEL_TEMPLATES: TemplateConfig[] = [defaultTemplate]

export function getTemplate(id: string): TemplateConfig | undefined {
  return CAROUSEL_TEMPLATES.find((t) => t.id === id)
}
