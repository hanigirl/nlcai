import type { TemplateConfig } from "./index"

/**
 * The four carousel templates — all rendered by gpt-image-2 with ONE
 * shared design language (see the carousel-design skill, derived from
 * ChatGPT carousels Hani approved): conceptual 3D translucent visual per
 * slide, gradient-highlighted key word, texture accents, number badge.
 *
 * A template contributes ONLY palette/contrast/mood via `aiStyleSpec`
 * (per Hani 2026-07-09: exactly four — dark / light / vibrant / neon).
 */

export const aiDarkTemplate: TemplateConfig = {
  id: "ai-dark",
  name: "כהה (AI)",
  kind: "ai",
  thumbnailUrl: "/images/carousel-templates/ai-dark.png",
  size: { width: 1080, height: 1350 },
  preview: {
    bg: "#101218",
    accent: "#6366F1",
    titleColor: "#FFFFFF",
    bodyColor: "#D7DBFF",
  },
  aiStyleSpec: [
    "Palette & mood for this series (DARK):",
    "- Deep graphite-navy canvas (#101218 range) with a soft dark vignette.",
    "- Accent gradient for the key word and object lighting: soft periwinkle → indigo (#A5B4FC → #6366F1).",
    "- Cool translucent glass objects in muted blue-violet tones; crisp white primary text.",
    "- Calm, premium, focused night mood.",
  ].join("\n"),
}

export const aiLightTemplate: TemplateConfig = {
  id: "ai-light",
  name: "בהיר (AI)",
  kind: "ai",
  thumbnailUrl: "/images/carousel-templates/ai-light.png",
  size: { width: 1080, height: 1350 },
  preview: {
    bg: "#F5F8FD",
    accent: "#4338CA",
    titleColor: "#101828",
    bodyColor: "#101828",
  },
  aiStyleSpec: [
    "Palette & mood for this series (LIGHT — inverted contrast):",
    "- Airy off-white canvas (#F5F8FD range) with soft cool gradient lighting.",
    "- Accent gradient for the key word and object lighting: sky blue → indigo (#7DA7FF → #4338CA).",
    "- Frosted translucent glass objects in pale blue tones; near-black (#101828) primary text.",
    "- Clean, optimistic, editorial daylight mood.",
  ].join("\n"),
}

export const aiVibrantTemplate: TemplateConfig = {
  id: "ai-vibrant",
  name: "ויברנטי (AI)",
  kind: "ai",
  thumbnailUrl: "/images/carousel-templates/ai-vibrant.png",
  size: { width: 1080, height: 1350 },
  preview: {
    bg: "#8B2FC9",
    accent: "#FDE047",
    titleColor: "#FFFFFF",
    bodyColor: "#FFEFFB",
  },
  aiStyleSpec: [
    "Palette & mood for this series (VIBRANT):",
    "- Rich saturated violet → magenta gradient canvas (#6D28D9 → #D946EF).",
    "- Accent gradient for the key word: warm yellow → orange (#FDE047 → #FB923C).",
    "- Colorful translucent glass objects catching pink-orange light; crisp white primary text.",
    "- Energetic, bold, playful mood — saturated but never muddy.",
  ].join("\n"),
}

export const aiNeonTemplate: TemplateConfig = {
  id: "ai-neon",
  name: "ניאון (AI)",
  kind: "ai",
  thumbnailUrl: "/images/carousel-templates/ai-neon.png",
  size: { width: 1080, height: 1350 },
  preview: {
    bg: "#06060F",
    accent: "#22D3EE",
    titleColor: "#FFFFFF",
    bodyColor: "#D9F6FF",
  },
  aiStyleSpec: [
    "Palette & mood for this series (NEON):",
    "- Near-black canvas (#06060F range) lit by glowing neon light ribbons and soft haze.",
    "- Accent gradient for the key word and rim lighting: electric cyan ↔ hot magenta (#22D3EE ↔ #E879F9).",
    "- Glassy objects edge-lit with neon glow; crisp white primary text (the text itself stays clean, no glow on letters).",
    "- Cinematic night-city mood — dramatic but legible.",
  ].join("\n"),
}
