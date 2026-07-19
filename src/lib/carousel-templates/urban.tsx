import type { TemplateConfig } from "./index"
import { RtlText, ProgressDots, SlideNumberBadge } from "./shared"

/**
 * "אורבני" — high-contrast mono + brand yellow. IG portrait (1080×1350).
 * Rhythm: ink cover → light content slides → full-yellow CTA.
 */
const LIGHT = "#F5F4F1"
const INK = "#141414"
const YELLOW = "#FFC300"

const W = 1080
const H = 1350

function AccentBar({ color }: { color: string }) {
  return (
    <div
      style={{
        display: "flex",
        width: 120,
        height: 12,
        borderRadius: 6,
        backgroundColor: color,
      }}
    />
  )
}

export const urbanTemplate: TemplateConfig = {
  id: "urban",
  name: "אורבני",
  thumbnailUrl: "/images/carousel-templates/urban.png",
  size: { width: W, height: H },
  preview: {
    bg: LIGHT,
    accent: YELLOW,
    titleColor: INK,
    bodyColor: INK,
  },
  render: (slide, slideIndex, totalSlides) => {
    const isCover = slide.type === "cover"
    const isCta = slide.type === "cta"

    const bg = isCover ? INK : isCta ? YELLOW : LIGHT
    const titleColor = isCover ? LIGHT : INK
    const bodyColor = isCover ? LIGHT : INK
    const barColor = isCover ? YELLOW : isCta ? INK : YELLOW

    return (
      <div
        style={{
          width: W,
          height: H,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          padding: 100,
          gap: 48,
          backgroundColor: bg,
          fontFamily: "Rubik",
        }}
      >
        {!isCover && !isCta && (
          <SlideNumberBadge number={slideIndex + 1} bg={INK} color={LIGHT} />
        )}

        <RtlText
          text={slide.title}
          style={{
            fontSize: isCover ? 84 : isCta ? 76 : 64,
            fontWeight: 800,
            color: titleColor,
            lineHeight: 1.22,
            maxWidth: 880,
          }}
        />

        <AccentBar color={barColor} />

        {slide.body && (
          <RtlText
            text={slide.body}
            style={{
              fontSize: 42,
              fontWeight: isCta ? 500 : 400,
              color: bodyColor,
              lineHeight: 1.55,
              maxWidth: 860,
            }}
          />
        )}

        <ProgressDots
          total={totalSlides}
          current={slideIndex}
          activeColor={isCover ? YELLOW : INK}
          inactiveColor={isCover ? "rgba(245,244,241,0.35)" : "rgba(20,20,20,0.25)"}
        />
      </div>
    )
  },
}
