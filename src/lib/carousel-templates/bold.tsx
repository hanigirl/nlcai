import type { TemplateConfig } from "./index"
import { RtlText, ProgressDots, SlideNumberBadge } from "./shared"

/**
 * "נועז" — deep navy + coral, oversized type. IG portrait (1080×1350).
 * Rhythm: navy cover with a decorative coral disc bleeding off-canvas →
 * warm-white content slides → full-coral CTA.
 */
const NAVY = "#10203B"
const CORAL = "#FF5A47"
const WARM = "#FFF6EF"

const W = 1080
const H = 1350

export const boldTemplate: TemplateConfig = {
  id: "bold",
  name: "נועז",
  size: { width: W, height: H },
  preview: {
    bg: WARM,
    accent: CORAL,
    titleColor: NAVY,
    bodyColor: NAVY,
  },
  render: (slide, slideIndex, totalSlides) => {
    const isCover = slide.type === "cover"
    const isCta = slide.type === "cta"

    const bg = isCover ? NAVY : isCta ? CORAL : WARM
    const titleColor = isCover || isCta ? WARM : NAVY
    const bodyColor = isCover || isCta ? WARM : NAVY

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
          gap: 44,
          backgroundColor: bg,
          fontFamily: "Rubik",
        }}
      >
        {/* Decorative disc bleeding off the top-right corner */}
        <div
          style={{
            position: "absolute",
            top: -140,
            right: -140,
            width: 360,
            height: 360,
            borderRadius: 180,
            backgroundColor: isCover ? CORAL : isCta ? NAVY : CORAL,
          }}
        />

        {!isCover && !isCta && (
          <SlideNumberBadge number={slideIndex + 1} bg={CORAL} color={WARM} />
        )}

        <RtlText
          text={slide.title}
          style={{
            fontSize: isCover ? 92 : isCta ? 84 : 66,
            fontWeight: 800,
            color: titleColor,
            lineHeight: 1.18,
            maxWidth: 880,
          }}
        />

        {slide.body && (
          <RtlText
            text={slide.body}
            style={{
              fontSize: 42,
              fontWeight: isCta ? 600 : 400,
              color: bodyColor,
              lineHeight: 1.55,
              maxWidth: 860,
            }}
          />
        )}

        <ProgressDots
          total={totalSlides}
          current={slideIndex}
          activeColor={isCover ? CORAL : isCta ? WARM : CORAL}
          inactiveColor={
            isCover || isCta ? "rgba(255,246,239,0.35)" : "rgba(16,32,59,0.2)"
          }
        />
      </div>
    )
  },
}
