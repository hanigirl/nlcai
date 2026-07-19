import type { TemplateConfig } from "./index"
import { RtlText, ProgressDots } from "./shared"

/**
 * "ויברנטי" — Heebo Black, violet→magenta gradient, lime accents.
 * IG portrait (1080×1350). Deliberately a different design SYSTEM from the
 * Rubik templates: right-aligned text column, giant lime slide number as a
 * composition element (not a badge), gradient canvas, inverted lime CTA.
 */
const GRADIENT = "linear-gradient(160deg, #3A0CA3 0%, #7209B7 55%, #B5179E 100%)"
const VIOLET = "#3A0CA3"
const LIME = "#D9FF3D"
const WHITE = "#FFFFFF"

const W = 1080
const H = 1350

export const vibrantTemplate: TemplateConfig = {
  id: "vibrant",
  name: "ויברנטי",
  thumbnailUrl: "/images/carousel-templates/vibrant.png",
  size: { width: W, height: H },
  preview: {
    bg: "#7209B7",
    accent: LIME,
    titleColor: WHITE,
    bodyColor: WHITE,
  },
  render: (slide, slideIndex, totalSlides) => {
    const isCover = slide.type === "cover"
    const isCta = slide.type === "cta"

    const titleColor = isCta ? VIOLET : WHITE
    const bodyColor = isCta ? VIOLET : WHITE

    return (
      <div
        style={{
          width: W,
          height: H,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "flex-end",
          padding: 96,
          gap: 40,
          backgroundColor: isCta ? LIME : VIOLET,
          // Satori chokes on explicit `undefined` style values — only add
          // the gradient key when it exists.
          ...(isCta ? {} : { backgroundImage: GRADIENT }),
          fontFamily: "Heebo",
        }}
      >
        {/* Giant slide number as a composition element (top-left) */}
        {!isCover && !isCta && (
          <div
            style={{
              position: "absolute",
              top: 24,
              left: 56,
              display: "flex",
              fontSize: 220,
              fontWeight: 900,
              color: LIME,
              lineHeight: 1,
            }}
          >
            {slideIndex + 1}
          </div>
        )}

        {/* Lime corner block on the cover, violet on the CTA */}
        {(isCover || isCta) && (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: 220,
              height: 44,
              backgroundColor: isCta ? VIOLET : LIME,
            }}
          />
        )}

        <RtlText
          text={slide.title}
          align="right"
          style={{
            fontSize: isCover ? 96 : isCta ? 84 : 68,
            fontWeight: 900,
            color: titleColor,
            lineHeight: 1.15,
            maxWidth: 880,
          }}
        />

        {/* Accent underline hugging the right edge of the text column */}
        <div
          style={{
            display: "flex",
            width: 160,
            height: 14,
            backgroundColor: isCta ? VIOLET : LIME,
          }}
        />

        {slide.body && (
          <RtlText
            text={slide.body}
            align="right"
            style={{
              fontSize: 42,
              fontWeight: isCta ? 700 : 400,
              color: bodyColor,
              lineHeight: 1.55,
              maxWidth: 840,
            }}
          />
        )}

        <ProgressDots
          total={totalSlides}
          current={slideIndex}
          activeColor={isCta ? VIOLET : LIME}
          inactiveColor={isCta ? "rgba(58,12,163,0.3)" : "rgba(255,255,255,0.35)"}
        />
      </div>
    )
  },
}
