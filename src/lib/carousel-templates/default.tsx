import type { TemplateConfig } from "./index"
import { SLIDE_SIZE, RtlText, ProgressDots, SlideNumberBadge } from "./shared"

// Palette: warm cream + dark brown + brand yellow (project's yellow-10/95
// primitives, hardcoded because satori renders a canvas, not app UI).
const CREAM = "#FFF9E5"
const BROWN = "#332700"
const YELLOW = "#FFC300"
const BODY_GRAY = "#4D4D4D"
const DOT_GRAY = "#E6E6E6"

export const defaultTemplate: TemplateConfig = {
  id: "default",
  name: "מינימליסטי",
  thumbnailUrl: "/images/carousel-templates/default.png",
  preview: {
    bg: CREAM,
    accent: YELLOW,
    titleColor: BROWN,
    bodyColor: BODY_GRAY,
  },
  render: (slide, slideIndex, totalSlides) => {
    const isCover = slide.type === "cover"
    const isCta = slide.type === "cta"
    const isDark = isCover || isCta

    return (
      <div
        style={{
          width: SLIDE_SIZE,
          height: SLIDE_SIZE,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          padding: 80,
          backgroundColor: isDark ? BROWN : CREAM,
          fontFamily: "Rubik",
        }}
      >
        {/* Slide number indicator */}
        {!isCover && (
          <SlideNumberBadge
            number={slideIndex + 1}
            bg={isCta ? YELLOW : BROWN}
            color={isCta ? BROWN : CREAM}
          />
        )}

        {/* Title */}
        <RtlText
          text={slide.title}
          style={{
            fontSize: isCover ? 64 : 52,
            fontWeight: 700,
            color: isDark ? YELLOW : BROWN,
            lineHeight: 1.3,
            marginBottom: slide.body ? 40 : 0,
            maxWidth: 920,
          }}
        />

        {/* Body */}
        {slide.body && (
          <RtlText
            text={slide.body}
            style={{
              fontSize: 32,
              fontWeight: 400,
              color: isDark ? CREAM : BODY_GRAY,
              lineHeight: 1.6,
              maxWidth: 860,
            }}
          />
        )}

        <ProgressDots
          total={totalSlides}
          current={slideIndex}
          activeColor={isDark ? YELLOW : BROWN}
          inactiveColor={isDark ? "rgba(255,255,255,0.3)" : DOT_GRAY}
        />
      </div>
    )
  },
}
