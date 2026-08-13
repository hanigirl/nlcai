/**
 * The caption that goes ON a piece of media — hook above, body below.
 *
 * Extracted from `api/story/generate-video-media` (Hani, 2026-07-29) so the
 * b-roll generator can lay the SAME caption over a generated background. One
 * renderer means the caption looks identical whether it lands on the user's
 * own clip or on an image we made; two copies would drift within a week.
 *
 * Visual language is the reel cover's: white Rubik on a SOLID black pill,
 * 24px radius, centred, inside the Instagram safe zone. The pill carries the
 * contrast, so there's no scrim and no text-shadow on top of it.
 */

import satori from "satori"
import { Resvg } from "@resvg/resvg-js"
import { RtlText } from "@/lib/carousel-templates/shared"
import { BROLL_VIDEO_CTA } from "@/lib/broll-copy"

export const CAPTION_CANVAS_WIDTH = 1080
export const CAPTION_CANVAS_HEIGHT = 1920

/**
 * Where the caption block sits on the canvas.
 *
 * The 9:16 surfaces (story / b-roll) were born bottom-anchored and stay that
 * way by default — the Instagram reply bar and the profile header carve the
 * safe zone out of the top and bottom, so "bottom" there means "above the
 * reply bar", not "at the edge".
 */
export type CaptionPosition = "top" | "center" | "bottom"

export interface CaptionCanvas {
  width: number
  height: number
  /** Clear space above the caption block when it is top-anchored. */
  padTop: number
  /** Clear space below the caption block when it is bottom-anchored. */
  padBottom: number
  /** Side gutters. */
  padX: number
}

/**
 * 9:16 vertical — story and b-roll. The generous bottom padding is the
 * Instagram reply bar (~24% of the height); the top one clears the profile
 * header (~14%).
 */
export const CANVAS_9_16: CaptionCanvas = {
  width: 1080,
  height: 1920,
  padTop: 300,
  padBottom: 520,
  padX: 90,
}

/**
 * 4:5 portrait — the Instagram FEED image post. Nothing overlays a feed
 * image, so the safe zone is only a designer's margin rather than a UI
 * cut-out: the caption can sit far closer to the edge than it can on a story,
 * and the canvas is 570px shorter, so borrowing the story's 520px bottom
 * padding would push the text into the middle of the picture.
 */
export const CANVAS_4_5: CaptionCanvas = {
  width: 1080,
  height: 1350,
  padTop: 120,
  padBottom: 120,
  padX: 80,
}

// ---- Hebrew font ----
// Rubik, NOT Heebo: the local Heebo-*.ttf files are ~23KB Latin-only subsets
// with NO Hebrew glyphs (satori renders tofu boxes with them). The full
// Rubik-*.ttf files (~175KB) carry Hebrew.
let rubikExtraBold: ArrayBuffer | null = null
let rubikBold: ArrayBuffer | null = null

async function loadRubik() {
  if (rubikExtraBold && rubikBold)
    return { extraBold: rubikExtraBold, bold: rubikBold }
  const fs = await import("fs/promises")
  const path = await import("path")
  const read = async (file: string) => {
    const buf = await fs.readFile(
      path.join(process.cwd(), "public", "fonts", file),
    )
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  }
  rubikExtraBold = await read("Rubik-ExtraBold.ttf")
  rubikBold = await read("Rubik-Bold.ttf")
  return { extraBold: rubikExtraBold, bold: rubikBold }
}

/**
 * Font size steps down as the hook gets longer, so a short punchy hook is
 * big and a longer one still fits without overflowing the safe band.
 */
export function fontSizeForHook(text: string): number {
  const len = text.trim().length
  if (len <= 22) return 96
  if (len <= 44) return 78
  if (len <= 80) return 62
  return 52
}

/**
 * The body sits UNDER the hook and must read as secondary, so it steps down
 * from the hook's size — the ratio is what makes the hierarchy legible.
 */
export function fontSizeForBody(hookSize: number, body: string): number {
  const base = Math.round(hookSize * 0.46)
  const len = body.trim().length
  if (len <= 90) return base
  if (len <= 180) return Math.round(base * 0.86)
  return Math.round(base * 0.74)
}

/**
 * A body-only frame (frames 2+, or a one-frame story carrying everything).
 * The type SHRINKS to fit rather than the text being cut — a story that
 * silently drops its last sentence is worse than one set a size smaller.
 */
export function fontSizeForBodyOnly(text: string): number {
  const len = text.trim().length
  if (len <= 90) return 62
  if (len <= 180) return 52
  if (len <= 300) return 44
  if (len <= 460) return 38
  if (len <= 650) return 33
  return 28
}

/**
 * Last-resort ceiling. Nothing realistic reaches it — the frame split keeps
 * per-frame text far below — but an unbounded string would overflow the safe
 * zone no matter how small the type, so it is cut on a word boundary.
 */
const HARD_BODY_LIMIT = 1100

export function trimBodyForOverlay(body: string): string {
  const clean = body.trim().replace(/\s+/g, " ")
  if (clean.length <= HARD_BODY_LIMIT) return clean
  const cut = clean.slice(0, HARD_BODY_LIMIT)
  const lastSpace = cut.lastIndexOf(" ")
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()}…`
}

/**
 * Which image format a base64 blob actually is, read off its magic bytes.
 *
 * The background used to be hardcoded as `data:image/png` because the only
 * caller was gpt-image-2, which returns PNG. The moment a user's own picture
 * became a valid background that stopped being true — a Drive photo is
 * virtually always JPEG, and a JPEG announced as a PNG decodes to nothing, so
 * the caption rendered over a flat black rectangle. Sniffing here rather than
 * threading a mime through every caller means the next background source
 * can't reintroduce it.
 */
function imageMimeFromBase64(base64: string): string {
  if (base64.startsWith("/9j/")) return "image/jpeg"
  if (base64.startsWith("iVBOR")) return "image/png"
  if (base64.startsWith("R0lGOD")) return "image/gif"
  if (base64.startsWith("UklGR")) return "image/webp"
  // Unknown → PNG, which is what every in-house renderer produces.
  return "image/png"
}

/**
 * The caption layout, optionally over a background image.
 *
 * `backgroundBase64` present → a finished 9:16 image (the b-roll generator:
 * background from the model, caption from us — the model never has to spell
 * Hebrew). Absent → a transparent PNG for ffmpeg to lay over the user's own
 * footage.
 */
async function renderCaption(
  hook: string | undefined,
  body: string | undefined,
  backgroundBase64?: string,
  canvas: CaptionCanvas = CANVAS_9_16,
  position: CaptionPosition = "bottom",
): Promise<Buffer> {
  const { extraBold, bold } = await loadRubik()
  const W = canvas.width
  const H = canvas.height
  const hookSize = hook ? fontSizeForHook(hook) : 0
  const bodyText = body ? trimBodyForOverlay(body) : ""
  // With no headline above it, the body IS the frame's type and gets sized on
  // its own ladder — stepping down from a hook that isn't there would leave
  // later frames set absurdly small.
  const bodySize = !bodyText
    ? 0
    : hook
      ? fontSizeForBody(hookSize, bodyText)
      : fontSizeForBodyOnly(bodyText)

  const pill = {
    display: "flex" as const,
    backgroundColor: "#000000",
    borderRadius: 24,
    maxWidth: W - canvas.padX * 2,
  }

  // One flex column carries all three placements. Only the anchor padding
  // changes with the position, so the pill itself is identical wherever it
  // lands — a caption that restyled itself per position would read as three
  // different captions.
  const justifyContent =
    position === "top"
      ? ("flex-start" as const)
      : position === "center"
        ? ("center" as const)
        : ("flex-end" as const)

  const svg = await satori(
    <div
      style={{
        width: W,
        height: H,
        display: "flex",
        position: "relative",
      }}
    >
      {backgroundBase64 && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`data:${imageMimeFromBase64(backgroundBase64)};base64,${backgroundBase64}`}
          width={W}
          height={H}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: W,
            height: H,
            objectFit: "cover",
          }}
        />
      )}
      <div
        style={{
          width: W,
          height: H,
          display: "flex",
          flexDirection: "column",
          justifyContent,
          alignItems: "center",
          // The safe zone belongs to the CANVAS, not to this function: a
          // story has to clear Instagram's reply bar and profile header, a
          // feed image has nothing over it at all.
          paddingTop: position === "top" ? canvas.padTop : 0,
          paddingBottom: position === "bottom" ? canvas.padBottom : 0,
          paddingLeft: canvas.padX,
          paddingRight: canvas.padX,
          // The gap IS the separation between hook and body.
          gap: 20,
        }}
      >
        {hook && (
          <div style={{ ...pill, padding: "36px 48px" }}>
            {/* RtlText, NOT a raw string: satori has no BiDi, so bare Hebrew
                renders mirrored. Same shared helper the carousel uses. */}
            <RtlText
              text={hook}
              align="center"
              style={{
                color: "#ffffff",
                fontFamily: "Rubik",
                fontWeight: 800,
                fontSize: hookSize,
                lineHeight: 1.25,
              }}
            />
          </div>
        )}

        {bodyText && (
          <div style={{ ...pill, padding: "24px 40px" }}>
            <RtlText
              text={bodyText}
              align="center"
              style={{
                color: "#ffffff",
                fontFamily: "Rubik",
                // Bold under a headline (the weight drop reinforces the size
                // drop); ExtraBold when the body stands alone.
                fontWeight: hook ? 700 : 800,
                fontSize: bodySize,
                lineHeight: 1.35,
              }}
            />
          </div>
        )}
      </div>
    </div>,
    {
      width: W,
      height: H,
      fonts: [
        { name: "Rubik", data: extraBold, weight: 800, style: "normal" },
        { name: "Rubik", data: bold, weight: 700, style: "normal" },
      ],
    },
  )

  return Buffer.from(
    new Resvg(svg, {
      background: backgroundBase64 ? "#000000" : "rgba(0,0,0,0)",
    })
      .render()
      .asPng(),
  )
}

/** Transparent 9:16 caption layer, for ffmpeg to burn onto real footage. */
export function renderCaptionOverlayPng(
  hook: string | undefined,
  body?: string,
): Promise<Buffer> {
  return renderCaption(hook, body)
}

/**
 * A finished image: the given background with the caption over it.
 *
 * Defaults to the 9:16 story/b-roll canvas so the existing callers are
 * unchanged; the feed image post passes CANVAS_4_5 and, in the variant that
 * offers it, a position other than "bottom".
 */
export function renderCaptionOverImagePng(
  backgroundBase64: string,
  hook: string | undefined,
  body?: string,
  canvas: CaptionCanvas = CANVAS_9_16,
  position: CaptionPosition = "bottom",
): Promise<Buffer> {
  return renderCaption(hook, body, backgroundBase64, canvas, position)
}

/**
 * The follow-up line every b-roll carries (Hani, 2026-07-29): it appears a
 * couple of seconds after the hook, once the viewer has read it, and points
 * them at the caption below the post.
 *
 * Rendered as its OWN transparent layer rather than as part of the main
 * caption, because it has to arrive on a different beat — one PNG can't have
 * two entrances.
 */
export const SECONDARY_CAPTION_TEXT = BROLL_VIDEO_CTA

export async function renderSecondaryCaptionPng(
  text: string = SECONDARY_CAPTION_TEXT,
): Promise<Buffer> {
  const { extraBold, bold } = await loadRubik()

  const svg = await satori(
    <div
      style={{
        width: CAPTION_CANVAS_WIDTH,
        height: CAPTION_CANVAS_HEIGHT,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        alignItems: "center",
        // Sits below the main caption block, still clear of the reply bar.
        paddingBottom: 380,
        paddingLeft: 90,
        paddingRight: 90,
      }}
    >
      <div
        style={{
          display: "flex",
          backgroundColor: "#000000",
          borderRadius: 24,
          padding: "20px 36px",
          maxWidth: CAPTION_CANVAS_WIDTH - 180,
        }}
      >
        <RtlText
          text={text}
          align="center"
          style={{
            color: "#ffffff",
            fontFamily: "Rubik",
            fontWeight: 700,
            fontSize: 46,
            lineHeight: 1.2,
          }}
        />
      </div>
    </div>,
    {
      width: CAPTION_CANVAS_WIDTH,
      height: CAPTION_CANVAS_HEIGHT,
      fonts: [
        { name: "Rubik", data: extraBold, weight: 800, style: "normal" },
        { name: "Rubik", data: bold, weight: 700, style: "normal" },
      ],
    },
  )

  return Buffer.from(
    new Resvg(svg, { background: "rgba(0,0,0,0)" }).render().asPng(),
  )
}
