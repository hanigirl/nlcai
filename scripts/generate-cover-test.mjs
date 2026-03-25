import satori from "satori"
import { Resvg } from "@resvg/resvg-js"
import fs from "fs"
import path from "path"

const COVER_WIDTH = 1080
const COVER_HEIGHT = 1920

// Satori renders Hebrew characters LTR, so we reverse each line
function fixHebrew(text) {
  // Split into runs of Hebrew vs non-Hebrew
  // Then reverse the order of characters within Hebrew runs
  return text.split('').reverse().join('')
}
const lines = [fixHebrew("סוכן AI"), fixHebrew("למסע משתמש")]
const thumbnailBase64 = fs.readFileSync("/tmp/reel-thumb-b64.txt", "utf-8")

const fontRegular = fs.readFileSync(path.join(process.cwd(), "public", "fonts", "Rubik-Regular.ttf"))
const fontBold = fs.readFileSync(path.join(process.cwd(), "public", "fonts", "Rubik-Bold.ttf"))

const variations = [
  { name: "bottom-center", opacity: 0.4, justify: "flex-end", pb: 200 },
  { name: "bottom-dark", opacity: 0.55, justify: "flex-end", pb: 200 },
  { name: "center", opacity: 0.35, justify: "center", pb: 0 },
]

for (const v of variations) {
  // Each line is a separate text element to avoid RTL issues
  const textChildren = lines.map((line) => ({
    type: "div",
    props: {
      style: {
        display: "flex",
        justifyContent: "center",
        width: "100%",
      },
      children: {
        type: "span",
        props: {
          style: {
            color: "#FFFFFF",
            fontSize: 120,
            fontWeight: 700,
            fontFamily: "Rubik",
            textAlign: "center",
            textShadow: "0 6px 30px rgba(0,0,0,0.7)",
            letterSpacing: "-2px",
          },
          children: line,
        },
      },
    },
  }))

  const element = {
    type: "div",
    props: {
      style: { display: "flex", width: COVER_WIDTH, height: COVER_HEIGHT, position: "relative" },
      children: [
        {
          type: "img",
          props: {
            src: thumbnailBase64,
            style: { position: "absolute", top: 0, left: 0, width: COVER_WIDTH, height: COVER_HEIGHT, objectFit: "cover" },
          },
        },
        // Gradient overlay from bottom
        {
          type: "div",
          props: {
            style: {
              position: "absolute",
              top: 0,
              left: 0,
              width: COVER_WIDTH,
              height: COVER_HEIGHT,
              background: v.justify === "flex-end"
                ? `linear-gradient(to top, rgba(0,0,0,${v.opacity}) 0%, rgba(0,0,0,${v.opacity * 0.6}) 40%, rgba(0,0,0,0) 70%)`
                : `rgba(0,0,0,${v.opacity})`,
            },
          },
        },
        // Text container
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexDirection: "column",
              position: "absolute",
              top: 0,
              left: 0,
              width: COVER_WIDTH,
              height: COVER_HEIGHT,
              padding: "60px",
              paddingBottom: v.pb ? `${v.pb}px` : "60px",
              justifyContent: v.justify,
              alignItems: "center",
              gap: "10px",
            },
            children: textChildren,
          },
        },
      ],
    },
  }

  const svg = await satori(element, {
    width: COVER_WIDTH,
    height: COVER_HEIGHT,
    fonts: [
      { name: "Rubik", data: fontRegular.buffer.slice(fontRegular.byteOffset, fontRegular.byteOffset + fontRegular.byteLength), weight: 400, style: "normal" },
      { name: "Rubik", data: fontBold.buffer.slice(fontBold.byteOffset, fontBold.byteOffset + fontBold.byteLength), weight: 700, style: "normal" },
    ],
  })

  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: COVER_WIDTH } })
  const pngData = resvg.render()
  const pngBuffer = pngData.asPng()

  const outPath = path.join(process.cwd(), "images", `cover-${v.name}.png`)
  fs.writeFileSync(outPath, pngBuffer)
  console.log(`Generated: ${outPath}`)
}

console.log("Done!")
