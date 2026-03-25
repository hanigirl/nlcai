import type { TemplateConfig } from "./index"

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
          direction: "rtl",
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
        <div
          style={{
            display: "flex",
            textAlign: "center",
            fontSize: isCover ? 64 : 52,
            fontWeight: 700,
            color: isCover || isCta ? "#FFC300" : "#332700",
            lineHeight: 1.3,
            marginBottom: slide.body ? 40 : 0,
            maxWidth: 920,
          }}
        >
          {slide.title}
        </div>

        {/* Body */}
        {slide.body && (
          <div
            style={{
              display: "flex",
              textAlign: "center",
              fontSize: 32,
              fontWeight: 400,
              color: isCover || isCta ? "#FFF9E5" : "#4D4D4D",
              lineHeight: 1.6,
              maxWidth: 860,
            }}
          >
            {slide.body}
          </div>
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
