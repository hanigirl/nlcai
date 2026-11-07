import { launch } from "@/lib/broll-animation/render"

/**
 * Where her face is in her talking-head video (Hani, 2026-11-07: the
 * elements must never cover it). MediaPipe's face detector (BlazeFace,
 * short range — made for faces close to the camera) runs inside the same
 * headless Chromium that renders the overlays, on CPU/WASM, so it works the
 * same locally and on the server. No AI call, nothing stored.
 *
 * Boxes are fractions of the frame (0–1), so they hold at any resolution.
 */
export type Box = { x: number; y: number; w: number; h: number }

const TASKS = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14"
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite"

/** Faces in each frame (PNG/JPEG buffers). An empty list for a frame with none. */
export async function detectFaces(frames: Buffer[]): Promise<Box[][]> {
  if (!frames.length) return []
  const browser = await launch({ width: 640, height: 640 })
  try {
    const tab = await browser.newPage()
    await tab.setContent("<!doctype html><html><body></body></html>")
    const images = frames.map((f) => `data:image/png;base64,${f.toString("base64")}`)
    const result = (await tab.evaluate(
      `(async () => {
        const vision = await import(${JSON.stringify(`${TASKS}/vision_bundle.mjs`)});
        const files = await vision.FilesetResolver.forVisionTasks(${JSON.stringify(`${TASKS}/wasm`)});
        const detector = await vision.FaceDetector.createFromOptions(files, {
          baseOptions: { modelAssetPath: ${JSON.stringify(MODEL)}, delegate: "CPU" },
          runningMode: "IMAGE",
          minDetectionConfidence: 0.5,
        });
        const out = [];
        for (const src of ${JSON.stringify(images)}) {
          const img = new Image();
          img.src = src;
          await img.decode();
          const r = detector.detect(img);
          out.push(r.detections.map((d) => ({
            x: d.boundingBox.originX / img.naturalWidth,
            y: d.boundingBox.originY / img.naturalHeight,
            w: d.boundingBox.width / img.naturalWidth,
            h: d.boundingBox.height / img.naturalHeight,
          })));
        }
        detector.close();
        return out;
      })()`,
    )) as Box[][]
    return result
  } finally {
    await browser.close().catch(() => undefined)
  }
}

/**
 * Her face as it typically sits — the median box over the frames (no
 * head-and-shoulders growth, no union of every movement). For decisions like
 * where the captions go, not for keeping elements clear.
 */
export function faceZone(perFrame: Box[][]): Box | null {
  // The biggest face in each frame (her, not someone behind her).
  const boxes = perFrame.flatMap((f) => (f.length ? [f.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a))] : []))
  if (!boxes.length) return null
  const med = (vals: number[]) => {
    const v = [...vals].sort((a, b) => a - b)
    return v[Math.floor(v.length / 2)]
  }
  return { x: med(boxes.map((b) => b.x)), y: med(boxes.map((b) => b.y)), w: med(boxes.map((b) => b.w)), h: med(boxes.map((b) => b.h)) }
}

/**
 * One box around every face seen across the frames, grown to the head and
 * shoulders (BlazeFace boxes the face only; hair and chin sit outside it).
 */
export function headZone(perFrame: Box[][]): Box | null {
  const all = perFrame.flat()
  if (!all.length) return null
  let x0 = Math.min(...all.map((b) => b.x))
  let y0 = Math.min(...all.map((b) => b.y))
  let x1 = Math.max(...all.map((b) => b.x + b.w))
  let y1 = Math.max(...all.map((b) => b.y + b.h))
  const w = x1 - x0
  const h = y1 - y0
  x0 -= w * 0.35
  x1 += w * 0.35
  y0 -= h * 0.45
  y1 += h * 0.35
  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  return { x: clamp(x0), y: clamp(y0), w: clamp(x1) - clamp(x0), h: clamp(y1) - clamp(y0) }
}

export function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/**
 * Where an element goes so it never covers her head: kept as it is when it's
 * clear; else the largest free band (above / below / beside the head, inside
 * the reel safe area and off the captions' band) it fits in, shrunk if it
 * must. All in the overlay's 1080×1920 canvas.
 */
export type Placement = { scale: number; dx: number; dy: number }

export function placeClear(
  el: { x: number; y: number; w: number; h: number },
  head: { x: number; y: number; w: number; h: number },
  canvas: { w: number; h: number; top: number; bottom: number; side: number },
  reserved: { y: number; h: number } | null,
): Placement {
  const margin = 24
  const hit = (b: typeof el) =>
    intersects(b, { x: head.x - margin, y: head.y - margin, w: head.w + margin * 2, h: head.h + margin * 2 }) ||
    (!!reserved && b.y < reserved.y + reserved.h && reserved.y < b.y + b.h)
  if (!hit(el)) return { scale: 1, dx: 0, dy: 0 }
  const safeTop = canvas.top
  const safeBottom = canvas.h - canvas.bottom
  const left = canvas.side
  const right = canvas.w - canvas.side
  // Free bands, before the reserved captions band is cut out of them.
  const bands = [
    { x: left, y: safeTop, w: right - left, h: head.y - margin - safeTop }, // above
    { x: left, y: head.y + head.h + margin, w: right - left, h: safeBottom - (head.y + head.h + margin) }, // below
    { x: left, y: Math.max(safeTop, head.y), w: head.x - margin - left, h: Math.min(safeBottom, head.y + head.h) - Math.max(safeTop, head.y) }, // beside, right of frame in RTL terms
    { x: head.x + head.w + margin, y: Math.max(safeTop, head.y), w: right - (head.x + head.w + margin), h: Math.min(safeBottom, head.y + head.h) - Math.max(safeTop, head.y) },
  ]
    .flatMap((b) => {
      if (!reserved) return [b]
      // Split a band around the captions' band.
      const r0 = reserved.y - margin
      const r1 = reserved.y + reserved.h + margin
      if (b.y + b.h <= r0 || b.y >= r1) return [b]
      return [
        { ...b, h: r0 - b.y },
        { ...b, y: r1, h: b.y + b.h - r1 },
      ]
    })
    .filter((b) => b.w > 80 && b.h > 60)
  // No room anywhere: small, in the top corner of the safe area (never on her face's centre).
  if (!bands.length) return { scale: 0.35, dx: left - el.x * 0.35, dy: safeTop - el.y * 0.35 }
  // The band that keeps the element biggest.
  const best = bands
    .map((b) => ({ b, s: Math.min(1, b.w / el.w, b.h / el.h) }))
    .sort((a, b) => b.s - a.s || b.b.w * b.b.h - a.b.w * a.b.h)[0]
  // Never smaller than half — a card too small to read is no card. Then it
  // sits at the band's outer edge (away from her face), touching her hair at most.
  const s = Math.max(0.5, best.s)
  const w = el.w * s
  const h = el.h * s
  const tx = best.b.x + (best.b.w - w) / 2
  const above = best.b.y + best.b.h <= head.y
  const below = best.b.y >= head.y + head.h
  const ty = s > best.s
    ? above
      ? best.b.y
      : below
        ? best.b.y + best.b.h - h
        : best.b.y + (best.b.h - h) / 2
    : best.b.y + (best.b.h - h) / 2
  // The whole overlay is scaled by s, then moved so the element lands at (tx, ty).
  return { scale: s, dx: tx - el.x * s, dy: ty - el.y * s }
}
