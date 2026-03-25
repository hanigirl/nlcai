import satori from "satori"
import { Resvg } from "@resvg/resvg-js"
import fs from "fs"
import path from "path"

const COVER_WIDTH = 1080
const COVER_HEIGHT = 1920

// Load fonts
const fontsDir = path.join(process.cwd(), ".claude", "skills", "canvas-fonts")
const fontBold = fs.readFileSync(path.join(fontsDir, "Rubik-Bold.ttf"))
const fontBlack = fs.readFileSync(path.join(fontsDir, "Rubik-Black.ttf"))
const fontLight = fs.readFileSync(path.join(fontsDir, "Rubik-Light.ttf"))

function toArrayBuffer(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

// Hebrew lines - reversed for Satori RTL fix
function fix(text) {
  return text.split('').reverse().join('')
}

const lines = [
  { text: fix("3 דברים"), size: 120, weight: 900, color: "#FFFFFF" },
  { text: fix("שבגללם מפתחים"), size: 96, weight: 700, color: "#FFFFFF" },
  { text: fix("מקללים אתכם"), size: 96, weight: 700, color: "#FFD60A" },
  { text: fix("בלב"), size: 120, weight: 900, color: "#FFFFFF" },
]

// Background: dark moody gradient with subtle texture pattern
const element = {
  type: "div",
  props: {
    style: {
      display: "flex",
      width: COVER_WIDTH,
      height: COVER_HEIGHT,
      position: "relative",
      background: "linear-gradient(180deg, #0a0a12 0%, #111128 30%, #1a1a3e 60%, #0d0d1a 100%)",
    },
    children: [
      // Subtle grid pattern overlay
      {
        type: "div",
        props: {
          style: {
            position: "absolute",
            top: 0,
            left: 0,
            width: COVER_WIDTH,
            height: COVER_HEIGHT,
            backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.03) 1px, transparent 0)",
            backgroundSize: "40px 40px",
          },
        },
      },
      // Subtle glow behind text area
      {
        type: "div",
        props: {
          style: {
            position: "absolute",
            bottom: "200px",
            left: "50%",
            width: "800px",
            height: "600px",
            borderRadius: "50%",
            background: "radial-gradient(ellipse, rgba(100,80,200,0.12) 0%, transparent 70%)",
            transform: "translateX(-50%)",
          },
        },
      },
      // Small accent line top
      {
        type: "div",
        props: {
          style: {
            position: "absolute",
            top: "80px",
            right: "60px",
            width: "40px",
            height: "3px",
            backgroundColor: "#FFD60A",
            borderRadius: "2px",
          },
        },
      },
      // Small marker text top right
      {
        type: "div",
        props: {
          style: {
            position: "absolute",
            top: "100px",
            right: "60px",
            display: "flex",
          },
          children: {
            type: "span",
            props: {
              style: {
                fontFamily: "Rubik",
                fontSize: 14,
                fontWeight: 300,
                color: "rgba(255,255,255,0.3)",
                letterSpacing: "3px",
              },
              children: "REEL COVER — 2026",
            },
          },
        },
      },
      // Main text block - bottom area
      {
        type: "div",
        props: {
          style: {
            position: "absolute",
            bottom: "160px",
            right: "60px",
            left: "60px",
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: "8px",
          },
          children: lines.map((line) => ({
            type: "div",
            props: {
              style: {
                display: "flex",
                justifyContent: "flex-end",
                width: "100%",
              },
              children: {
                type: "span",
                props: {
                  style: {
                    fontFamily: "Rubik",
                    fontSize: line.size,
                    fontWeight: line.weight,
                    color: line.color,
                    lineHeight: 1.1,
                    letterSpacing: "-1px",
                  },
                  children: line.text,
                },
              },
            },
          })),
        },
      },
      // Bottom thin line
      {
        type: "div",
        props: {
          style: {
            position: "absolute",
            bottom: "60px",
            right: "60px",
            left: "60px",
            height: "1px",
            backgroundColor: "rgba(255,255,255,0.08)",
          },
        },
      },
      // Bottom label
      {
        type: "div",
        props: {
          style: {
            position: "absolute",
            bottom: "30px",
            right: "60px",
            display: "flex",
          },
          children: {
            type: "span",
            props: {
              style: {
                fontFamily: "Rubik",
                fontSize: 11,
                fontWeight: 300,
                color: "rgba(255,255,255,0.2)",
                letterSpacing: "2px",
              },
              children: "UX × DEV",
            },
          },
        },
      },
    ],
  },
}

const svg = await satori(element, {
  width: COVER_WIDTH,
  height: COVER_HEIGHT,
  fonts: [
    { name: "Rubik", data: toArrayBuffer(fontLight), weight: 300, style: "normal" },
    { name: "Rubik", data: toArrayBuffer(fontBold), weight: 700, style: "normal" },
    { name: "Rubik", data: toArrayBuffer(fontBlack), weight: 900, style: "normal" },
  ],
})

const resvg = new Resvg(svg, { fitTo: { mode: "width", value: COVER_WIDTH } })
const pngData = resvg.render()
const pngBuffer = pngData.asPng()

const outPath = path.join(process.cwd(), "images", "cover-art-v1.png")
fs.writeFileSync(outPath, pngBuffer)
console.log(`Generated: ${outPath}`)

// Second pass - refine: tighter spacing, cleaner composition
// Variation with gradient overlay from bottom
const element2 = {
  type: "div",
  props: {
    style: {
      display: "flex",
      width: COVER_WIDTH,
      height: COVER_HEIGHT,
      position: "relative",
      background: "linear-gradient(170deg, #0f0f1f 0%, #141430 40%, #0a0a18 100%)",
    },
    children: [
      // Dot grid
      {
        type: "div",
        props: {
          style: {
            position: "absolute",
            top: 0,
            left: 0,
            width: COVER_WIDTH,
            height: COVER_HEIGHT,
            backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,214,10,0.04) 1px, transparent 0)",
            backgroundSize: "48px 48px",
          },
        },
      },
      // Accent block
      {
        type: "div",
        props: {
          style: {
            position: "absolute",
            top: "80px",
            right: "60px",
            width: "6px",
            height: "60px",
            backgroundColor: "#FFD60A",
            borderRadius: "3px",
          },
        },
      },
      // Text block - right aligned, bottom
      {
        type: "div",
        props: {
          style: {
            position: "absolute",
            bottom: "180px",
            right: "60px",
            left: "60px",
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: "4px",
          },
          children: [
            {
              type: "span",
              props: {
                style: { fontFamily: "Rubik", fontSize: 130, fontWeight: 900, color: "#FFFFFF", lineHeight: 1.05 },
                children: fix("3 דברים"),
              },
            },
            {
              type: "span",
              props: {
                style: { fontFamily: "Rubik", fontSize: 88, fontWeight: 700, color: "rgba(255,255,255,0.9)", lineHeight: 1.1 },
                children: fix("שבגללם מפתחים"),
              },
            },
            {
              type: "span",
              props: {
                style: { fontFamily: "Rubik", fontSize: 92, fontWeight: 900, color: "#FFD60A", lineHeight: 1.1 },
                children: fix("מקללים אתכם"),
              },
            },
            {
              type: "span",
              props: {
                style: { fontFamily: "Rubik", fontSize: 130, fontWeight: 900, color: "#FFFFFF", lineHeight: 1.05 },
                children: fix("בלב"),
              },
            },
          ].map(child => ({
            type: "div",
            props: { style: { display: "flex", justifyContent: "flex-end", width: "100%" }, children: child },
          })),
        },
      },
    ],
  },
}

const svg2 = await satori(element2, {
  width: COVER_WIDTH,
  height: COVER_HEIGHT,
  fonts: [
    { name: "Rubik", data: toArrayBuffer(fontLight), weight: 300, style: "normal" },
    { name: "Rubik", data: toArrayBuffer(fontBold), weight: 700, style: "normal" },
    { name: "Rubik", data: toArrayBuffer(fontBlack), weight: 900, style: "normal" },
  ],
})

const resvg2 = new Resvg(svg2, { fitTo: { mode: "width", value: COVER_WIDTH } })
const png2 = resvg2.render()
fs.writeFileSync(path.join(process.cwd(), "images", "cover-art-v2.png"), png2.asPng())
console.log("Generated: cover-art-v2.png")

console.log("Done!")
