import { spawn } from "child_process"
import ffmpegPath from "ffmpeg-static"
import type { Word } from "@/lib/transcribe"

/**
 * Cuts for her talking-head video (Hani, 2026-11-08: "להוריד קטעים של ״אממ״,
 * קטעים ריקים בלי דיבור, ולהפוך את הסרטון לקצבי… ואם הסרטון איכותי מבחינת
 * הקאטים הוא לא נוגע"). Planned from the word-level transcript (lib/transcribe)
 * and the audio's loudness, before any captions or elements:
 *
 *   - fillers: "אממ", "אה", "אהה"… when transcribed, and a voiced stretch
 *     between words that Whisper left out (that's what an "אממ" usually is);
 *   - false starts / repeats: the same word (or two) said twice in a row —
 *     the first take goes;
 *   - silences longer than MAX_GAP, kept with a little breath on each side
 *     so the cut doesn't sound clipped.
 *
 * A tight video isn't touched (cutWorthIt). The cut itself is one ffmpeg pass:
 * the kept segments joined, each with a 30ms audio fade in and out so a cut
 * never clicks (a true crossfade would overlap the audio and drift it off the
 * picture). Captions and element times are then mapped onto the cut (remapTime).
 */

export type Segment = { start: number; end: number }
import type { CutStats } from "@/lib/talking-head-cut-message"
export type { CutStats }
export type CutPlan = { segments: Segment[]; stats: CutStats }

/** A silence longer than this is cut. */
export const MAX_GAP = 0.45
/** Breath kept before a word and after one, at a cut. */
const PAD_IN = 0.1
const PAD_OUT = 0.15
/** A voiced gap this long between words, with no word in it, is an untranscribed filler. */
const VOICED_FILLER_MIN = 0.25

const FILLER = /^(א+מ+|א+ה+|ה+מ+|מ{2,}|א+ה*מ+|uh+|um+|hm+|erm)$/i

const clean = (t: string) => t.replace(/[\s.,!?;:"'״׳()\-–—…]+/g, "").toLowerCase()

export function isFiller(text: string): boolean {
  const t = clean(text)
  return !!t && FILLER.test(t)
}

/** Which words go: fillers, and the first take of a repeat (1 or 2 words). */
export function wordsToDrop(words: Word[]): Set<number> {
  const drop = new Set<number>()
  const t = words.map((w) => clean(w.text))
  for (let i = 0; i < words.length; i++) {
    if (!t[i] || isFiller(words[i].text)) {
      if (t[i]) drop.add(i)
      continue
    }
    if (i + 1 < words.length && t[i] === t[i + 1]) drop.add(i)
    else if (i + 3 < words.length && t[i] === t[i + 2] && t[i + 1] === t[i + 3]) {
      drop.add(i)
      drop.add(i + 1)
    }
  }
  return drop
}

/** Share of 20ms frames above the voice threshold between a and b (0–1). */
function voicedShare(levels: number[] | null, a: number, b: number, threshold: number): number {
  if (!levels?.length || b <= a) return 0
  const i0 = Math.max(0, Math.floor(a / 0.02))
  const i1 = Math.min(levels.length, Math.ceil(b / 0.02))
  if (i1 <= i0) return 0
  let n = 0
  for (let i = i0; i < i1; i++) if (levels[i] >= threshold) n++
  return n / (i1 - i0)
}

function voiceThreshold(levels: number[] | null): number {
  if (!levels?.length) return Infinity
  const sorted = [...levels].sort((a, b) => a - b)
  const floor = sorted[Math.floor(sorted.length * 0.1)]
  const loud = sorted[Math.floor(sorted.length * 0.9)]
  return Math.max(floor + 10, loud - 18)
}

/**
 * The cut plan, or null when the video is already tight. `levels`: the
 * audio's loudness per 20ms (lib/transcribe audioLevels) — finds the
 * fillers Whisper didn't write down; without it only the transcript counts.
 */
export function planCuts(words: Word[], levels: number[] | null, duration: number): CutPlan | null {
  if (!words.length || duration <= 0) return null
  const drop = wordsToDrop(words)
  const kept = words.filter((_, i) => !drop.has(i))
  if (!kept.length) return null
  const threshold = voiceThreshold(levels)
  let fillers = [...drop].filter((i) => isFiller(words[i].text)).length
  let longest = 0

  const segments: Segment[] = []
  let cur: Segment = { start: Math.max(0, kept[0].start - PAD_IN), end: kept[0].end }
  for (let k = 1; k < kept.length; k++) {
    const a = kept[k - 1]
    const b = kept[k]
    const gap = b.start - a.end
    const dropped = words.some((w, i) => drop.has(i) && w.start >= a.end - 0.01 && w.end <= b.start + 0.01)
    const voicedFiller = !dropped && gap >= VOICED_FILLER_MIN && voicedShare(levels, a.end + 0.05, b.start - 0.05, threshold) > 0.4
    if (voicedFiller) fillers++
    if (gap > MAX_GAP || dropped || voicedFiller) {
      longest = Math.max(longest, gap)
      const end = Math.min(a.end + PAD_OUT, b.start)
      const nextStart = Math.max(b.start - PAD_IN, end)
      if (nextStart - end < 0.05) {
        cur.end = b.end
        continue
      }
      cur.end = end
      segments.push(cur)
      cur = { start: nextStart, end: b.end }
    } else {
      cur.end = b.end
    }
  }
  cur.end = Math.min(duration, cur.end + 0.3)
  segments.push(cur)

  const after = segments.reduce((s, x) => s + (x.end - x.start), 0)
  const removed = duration - after
  const fillerTime = [...drop].reduce((s, i) => s + (words[i].end - words[i].start), 0)
  const stats: CutStats = {
    fillers,
    silence: Math.max(0, removed - fillerTime),
    before: duration,
    after,
  }
  if (!cutWorthIt(stats, Math.max(longest, kept[0].start))) return null
  return { segments, stats }
}

/**
 * Only when the video needs it: two or more fillers, or 1.5s+ of dead air
 * altogether, or one pause of a second or more. Otherwise it's left alone.
 */
export function cutWorthIt(stats: CutStats, longestGap: number): boolean {
  return stats.fillers >= 2 || stats.silence >= 1.5 || longestGap >= 1
}

/** A time in the original → the same moment in the cut (inside a removed part: the next kept moment). */
export function remapTime(t: number, segments: Segment[]): number {
  let acc = 0
  for (const s of segments) {
    if (t < s.start) return acc
    if (t <= s.end) return acc + (t - s.start)
    acc += s.end - s.start
  }
  return acc
}

/** Her words on the cut's timeline — the dropped ones gone. */
export function remapWords(words: Word[], segments: Segment[]): Word[] {
  const drop = wordsToDrop(words)
  return words
    .filter((_, i) => !drop.has(i))
    .map((w) => ({ ...w, start: remapTime(w.start, segments), end: remapTime(w.end, segments) }))
    .filter((w) => w.end > w.start)
}

function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("ffmpeg binary not found"))
    const proc = spawn(ffmpegPath as unknown as string, args)
    let err = ""
    proc.stderr.on("data", (d) => (err = (err + d.toString()).slice(-4000)))
    proc.on("error", reject)
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err}`))))
  })
}

/** The kept segments joined, each fading its sound in and out over 30ms. */
export async function cutVideo(input: string, segments: Segment[], output: string, hasAudio: boolean): Promise<void> {
  const parts: string[] = []
  const pads: string[] = []
  segments.forEach((s, i) => {
    const len = Math.max(0.06, s.end - s.start)
    parts.push(`[0:v]trim=start=${s.start.toFixed(3)}:end=${s.end.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`)
    if (hasAudio) {
      parts.push(
        `[0:a]atrim=start=${s.start.toFixed(3)}:end=${s.end.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.03,afade=t=out:st=${(len - 0.03).toFixed(3)}:d=0.03[a${i}]`,
      )
      pads.push(`[v${i}][a${i}]`)
    } else pads.push(`[v${i}]`)
  })
  parts.push(`${pads.join("")}concat=n=${segments.length}:v=1:a=${hasAudio ? 1 : 0}${hasAudio ? "[v][a]" : "[v]"}`)
  await run([
    "-y",
    "-i", input,
    "-filter_complex", parts.join(";"),
    "-map", "[v]",
    ...(hasAudio ? ["-map", "[a]", "-c:a", "aac", "-b:a", "160k"] : []),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    output,
  ])
}

export { cutMessage } from "@/lib/talking-head-cut-message"
