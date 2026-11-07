import { spawn } from "child_process"
import ffmpegPath from "ffmpeg-static"
import { BROLL_MODEL } from "@/lib/broll-animation/compose"

/**
 * Word-level transcription for synced captions on her talking-head video
 * (Hani, 2026-11-07: "תמלול לכתוביות מסונכרנות — כן, ולהשתמש ב-Opus 5.5 לכל
 * עריכת דיבור למצלמה כזו").
 *
 * Provider: OpenAI `whisper-1` on HER OpenAI key (Settings → חיבורים — the
 * key the app already uses for images). It is the OpenAI speech model that
 * returns a timestamp for every word (`timestamp_granularities: ["word"]`)
 * and handles Hebrew. ~$0.006 per minute of audio.
 *
 * Flow: the video's audio is pulled out with ffmpeg (mono, 16kHz, 48kbps —
 * a 25-minute clip stays under the API's 25MB cap), sent once, and the words
 * come back with start / end seconds. `captionLines` groups them into the
 * 2–5-word lines a synced caption shows.
 */

/** Every planning / edit step of a talking-head AI edit runs on Opus 5.5 (her Claude key). */
export const TALKING_HEAD_MODEL = BROLL_MODEL // "claude-opus-5-5"

/**
 * Hani + Nataliya while the talking-head AI edit is being tried — the same
 * two as TALKING_HEAD_AI_EMAILS on joey/talking-head-ai-edit; fold into
 * lib/feature-access once that lands.
 */
export const TRANSCRIBE_EMAILS = ["hanigirl@gmail.com", "nataliya@nataliyarey.com"]
export function canTranscribe(email: string | null | undefined): boolean {
  return !!email && TRANSCRIBE_EMAILS.includes(email.toLowerCase())
}

export interface Word {
  text: string
  /** Seconds from the start of the video. */
  start: number
  end: number
}

export interface Transcript {
  words: Word[]
  /** The whole text, as the model wrote it (with punctuation). */
  text: string
  /** Audio length in seconds. */
  duration: number
}

/** Whisper's whole-file limit is 25MB; 48kbps mono is ~0.36MB a minute. */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024

/** The video's speech as a small mp3 (mono 16kHz 48kbps). */
export function extractAudio(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("ffmpeg binary not found"))
    const proc = spawn(ffmpegPath as unknown as string, [
      "-y",
      "-i", inputPath,
      "-vn",
      "-ac", "1",
      "-ar", "16000",
      "-b:a", "48k",
      outputPath,
    ])
    let stderr = ""
    proc.stderr.on("data", (d) => {
      stderr = (stderr + d.toString()).slice(-3000)
    })
    proc.on("error", reject)
    proc.on("close", (code) => {
      if (code === 0) return resolve()
      reject(new Error(/does not contain any stream|Output file #0 does not contain/i.test(stderr) ? "no_audio" : `ffmpeg exited ${code}: ${stderr}`))
    })
  })
}

/** Send the audio to whisper-1 and read back every word with its time. */
export async function transcribeAudio(openaiKey: string, audio: Buffer, language = "he"): Promise<Transcript> {
  if (audio.length > MAX_AUDIO_BYTES) throw new Error("audio_too_long")
  const form = new FormData()
  form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/mpeg" }), "audio.mp3")
  form.append("model", "whisper-1")
  form.append("language", language)
  form.append("response_format", "verbose_json")
  form.append("timestamp_granularities[]", "word")
  form.append("timestamp_granularities[]", "segment")
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}` },
    body: form,
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`transcription_failed ${res.status}: ${body.slice(0, 300)}`)
  }
  const data = (await res.json()) as {
    text?: string
    duration?: number
    words?: { word: string; start: number; end: number }[]
  }
  return parseWhisper(data)
}

/** Whisper's verbose_json → our shape (exported for tests). */
export function parseWhisper(data: {
  text?: string
  duration?: number
  words?: { word: string; start: number; end: number }[]
}): Transcript {
  const words = (data.words ?? [])
    .map((w) => ({ text: (w.word ?? "").trim(), start: Number(w.start), end: Number(w.end) }))
    .filter((w) => w.text && Number.isFinite(w.start) && Number.isFinite(w.end))
  return { words, text: (data.text ?? "").trim(), duration: Number(data.duration) || (words.at(-1)?.end ?? 0) }
}

export interface CaptionLine {
  text: string
  start: number
  end: number
  words: Word[]
}

export interface LineOptions {
  /** Fewest words on a line (a shorter one only when the speech ends). */
  min?: number
  /** Most words on a line. */
  max?: number
  /** A silence this long (seconds) between two words is a natural break. */
  pause?: number
  /** Longest line in characters — long Hebrew words fill a line sooner. */
  maxChars?: number
}

const SENTENCE_END = /[.!?…]["״”]?$/
const CLAUSE_END = /[,;:–—]$/

/**
 * Group the words into caption lines of 2–5 words, broken where she breaks:
 * at a pause in her speech, at the end of a sentence or clause — never in
 * the middle of a phrase when a natural break is near. Lines keep their
 * words' times, so each shows exactly while it is spoken.
 */
export function captionLines(words: Word[], opts: LineOptions = {}): CaptionLine[] {
  const min = opts.min ?? 2
  const max = opts.max ?? 5
  const pause = opts.pause ?? 0.35
  const maxChars = opts.maxChars ?? 28
  const lines: Word[][] = []
  let cur: Word[] = []
  const chars = (ws: Word[]) => ws.map((w) => w.text).join(" ").length

  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    // A long word that would overflow the line starts a new one.
    if (cur.length >= min && chars([...cur, w]) > maxChars) {
      lines.push(cur)
      cur = []
    }
    cur.push(w)
    const next = words[i + 1]
    if (!next) break
    const gap = next.start - w.end
    const atSentence = SENTENCE_END.test(w.text)
    const atClause = CLAUSE_END.test(w.text)
    const full = cur.length >= max
    const natural = cur.length >= min && (gap >= pause || atSentence || atClause)
    // A sentence end or a real pause breaks even a one-word line; never run past max.
    const forced = full || ((atSentence || gap >= pause * 2) && cur.length >= 1)
    if (natural || forced) {
      lines.push(cur)
      cur = []
    }
  }
  if (cur.length) lines.push(cur)

  // A lone trailing word is never left alone: it joins the line before it
  // when that stays within `max`, else takes that line's last word.
  if (lines.length > 1) {
    const last = lines[lines.length - 1]
    const prev = lines[lines.length - 2]
    if (last.length < min) {
      if (prev.length + last.length <= max && chars([...prev, ...last]) <= maxChars + 6) {
        lines.splice(lines.length - 2, 2, [...prev, ...last])
      } else if (prev.length > min) {
        last.unshift(prev.pop()!)
      }
    }
  }

  return lines.map((ws) => ({
    text: ws.map((w) => w.text).join(" "),
    start: ws[0].start,
    end: ws[ws.length - 1].end,
    words: ws,
  }))
}

/**
 * For the talking-head AI edit (Joey): her video (a storage URL or a Drive
 * link) → every word with its time. Server only. Throws "no_audio",
 * "audio_too_long", "video_fetch_failed …" or "transcription_failed …".
 */
export async function transcribeVideo(openaiKey: string, videoUrl: string): Promise<Transcript> {
  const os = await import("os")
  const fs = await import("fs/promises")
  const path = await import("path")
  const { createWriteStream } = await import("node:fs")
  const { Readable } = await import("node:stream")
  const { pipeline } = await import("node:stream/promises")
  const { isDriveUrl, extractDriveFileId } = await import("@/lib/drive-media")
  const { fetchDriveFile } = await import("@/lib/drive-fetch")

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "transcribe-"))
  try {
    const video = path.join(dir, "in.mp4")
    const audio = path.join(dir, "audio.mp3")
    const res = isDriveUrl(videoUrl) ? await fetchDriveFile(extractDriveFileId(videoUrl)!) : await fetch(videoUrl)
    const type = (res.headers.get("content-type") || "").split(";")[0]
    if (!res.ok || !res.body || type.includes("text/html")) throw new Error(`video_fetch_failed ${res.status}`)
    await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(video))
    await extractAudio(video, audio)
    return await transcribeAudio(openaiKey, await fs.readFile(audio))
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}
