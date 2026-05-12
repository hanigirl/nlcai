import type { TemplateConfig } from "./index"

// Satori (v0.26) does not run the Unicode Bidi Algorithm, so Hebrew text
// renders LTR — visually reversed for an RTL reader. Same workaround used in
// the reel-cover generator: reverse each word's characters and lay out words
// in row-reverse so the line reads right-to-left.
function reverseWord(word: string): string {
  return [...word].reverse().join("")
}

function RtlText({
  text,
  style,
}: {
  text: string
  style: React.CSSProperties
}) {
  // Preserve line breaks. Each line gets its own row-reverse row, otherwise
  // wrapping breaks the visual order.
  const lines = text.split("\n")
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", ...style }}>
      {lines.map((line, li) => {
        const words = line.split(" ")
        return (
          <div
            key={li}
            style={{
              display: "flex",
              flexDirection: "row-reverse",
              flexWrap: "wrap",
              justifyContent: "center",
              gap: "0.28em",
              maxWidth: "100%",
            }}
          >
            {words.map((w, wi) => (
              <span key={wi}>{reverseWord(w)}</span>
            ))}
          </div>
        )
      })}
    </div>
  )
}

export const defaultTemplate: TemplateConfig = {
  id: "default",
  name: "מינימליסטי",
  previewBg: "#FFF9E5",
  render: (slide, slideIndex, totalSlides) => {
    const isCover = slide.type === "cover"
    const isCta = slide.type === "cta"

    return (
      <div
        style={{
          width: 1080,
          height: 1080,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          padding: 80,
          backgroundColor: isCover ? "#332700" : isCta ? "#332700" : "#FFF9E5",
          fontFamily: "Rubik",
        }}
      >
        {/* Slide number indicator */}
        {!isCover && (
          <div
            style={{
              position: "absolute",
              top: 40,
              left: 40,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 48,
              height: 48,
              borderRadius: 24,
              backgroundColor: isCta ? "#FFC300" : "#332700",
              color: isCta ? "#332700" : "#FFF9E5",
              fontSize: 20,
              fontWeight: 600,
            }}
          >
            {slideIndex + 1}
          </div>
        )}

        {/* Title */}
        <RtlText
          text={slide.title}
          style={{
            fontSize: isCover ? 64 : 52,
            fontWeight: 700,
            color: isCover || isCta ? "#FFC300" : "#332700",
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
              color: isCover || isCta ? "#FFF9E5" : "#4D4D4D",
              lineHeight: 1.6,
              maxWidth: 860,
            }}
          />
        )}

        {/* Bottom bar */}
        <div
          style={{
            position: "absolute",
            bottom: 40,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          {Array.from({ length: totalSlides }).map((_, i) => (
            <div
              key={i}
              style={{
                width: i === slideIndex ? 32 : 10,
                height: 10,
                borderRadius: 5,
                backgroundColor:
                  isCover || isCta
                    ? i === slideIndex
                      ? "#FFC300"
                      : "rgba(255,255,255,0.3)"
                    : i === slideIndex
                      ? "#332700"
                      : "#E6E6E6",
              }}
            />
          ))}
        </div>
      </div>
    )
  },
}
