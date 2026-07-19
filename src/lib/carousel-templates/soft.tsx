import type { TemplateConfig } from "./index"
import { RtlText, ProgressDots, SlideNumberBadge } from "./shared"

/**
 * "רך" — editorial sage paper + terracotta, thin inner frame.
 * IG portrait (1080×1350). Rhythm: framed paper slides → inverted ink CTA.
 */
const PAPER = "#EDF0E8"
const INK = "#2F3A2F"
const TERRA = "#C0674A"

const W = 1080
const H = 1350

export const softTemplate: TemplateConfig = {
  id: "soft",
  name: "רך",
  thumbnailUrl: "/images/carousel-templates/soft.png",
  size: { width: W, height: H },
  preview: {
    bg: PAPER,
    accent: TERRA,
    titleColor: INK,
    bodyColor: INK,
  },
  render: (slide, slideIndex, totalSlides) => {
    const isCta = slide.type === "cta"
    const isCover = slide.type === "cover"

    const bg = isCta ? INK : PAPER
    const frameColor = isCta ? PAPER : INK
    const titleColor = isCta ? PAPER : INK
    const bodyColor = isCta ? PAPER : INK

    return (
      <div
        style={{
          width: W,
          height: H,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          padding: 110,
          gap: 44,
          backgroundColor: bg,
          fontFamily: "Rubik",
        }}
      >
        {/* Thin editorial inner frame */}
        <div
          style={{
            position: "absolute",
            top: 48,
            left: 48,
            right: 48,
            bottom: 48,
            border: `3px solid ${frameColor}`,
            borderRadius: 32,
          }}
        />

        {!isCover && !isCta && (
          <SlideNumberBadge
            number={slideIndex + 1}
            bg={TERRA}
            color={PAPER}
            offset={84}
          />
        )}

        {/* Small ornament dot above the title */}
        <div
          style={{
            display: "flex",
            width: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: TERRA,
          }}
        />

        <RtlText
          text={slide.title}
          style={{
            fontSize: isCover ? 76 : isCta ? 72 : 60,
            fontWeight: 700,
            color: titleColor,
            lineHeight: 1.25,
            maxWidth: 820,
          }}
        />

        {slide.body && (
          <RtlText
            text={slide.body}
            style={{
              fontSize: 40,
              fontWeight: isCta ? 500 : 400,
              color: bodyColor,
              lineHeight: 1.6,
              maxWidth: 800,
            }}
          />
        )}

        <ProgressDots
          total={totalSlides}
          current={slideIndex}
          activeColor={TERRA}
          inactiveColor={isCta ? "rgba(237,240,232,0.35)" : "rgba(47,58,47,0.25)"}
          bottom={92}
        />
      </div>
    )
  },
}
