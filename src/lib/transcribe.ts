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
export async function transcribeAudio(
  openaiKey: string,
  audio: Buffer,
  language = "he",
  /**
   * Words she is likely to say — the post's script and her brand names. Whisper
   * uses it as context, so names come back spelled her way (it reads ~224
   * tokens; the tail is what counts).
   */
  prompt?: string,
): Promise<Transcript> {
  if (audio.length > MAX_AUDIO_BYTES) throw new Error("audio_too_long")
  const form = new FormData()
  form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/mpeg" }), "audio.mp3")
  form.append("model", "whisper-1")
  form.append("language", language)
  form.append("response_format", "verbose_json")
  form.append("timestamp_granularities[]", "word")
  form.append("timestamp_granularities[]", "segment")
  if (prompt?.trim()) form.append("prompt", prompt.trim().slice(-800))
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
  const text = (data.text ?? "").trim()
  const words = withPunctuation(
    (data.words ?? [])
      .map((w) => ({ text: (w.word ?? "").trim(), start: Number(w.start), end: Number(w.end) }))
      .filter((w) => w.text && Number.isFinite(w.start) && Number.isFinite(w.end)),
    text,
  )
  return { words, text, duration: Number(data.duration) || (words.at(-1)?.end ?? 0) }
}

const bare = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, "")

/**
 * Whisper's word list comes without punctuation (its full text has it), and
 * the line breaker needs it to break at sentence and clause ends. Walk the
 * text's tokens alongside the words and give each word its token's
 * punctuation. A word that can't be matched keeps its own text.
 */
function withPunctuation(words: Word[], text: string): Word[] {
  const tokens = text.split(/\s+/).filter(Boolean)
  let t = 0
  return words.map((w) => {
    const key = bare(w.text)
    for (let k = t; k < Math.min(tokens.length, t + 4); k++) {
      if (bare(tokens[k]) === key) {
        t = k + 1
        return { ...w, text: tokens[k] }
      }
    }
    return w
  })
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
    // Never run past max; a sentence end breaks even a one-word line.
    const forced = full || atSentence
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
export async function transcribeVideo(
  openaiKey: string,
  videoUrl: string,
  opts: {
    /** The post's script (hook + talking-head text) — context for Whisper and the spelling reference. */
    script?: string
    /** Her brand names / handle, for the Whisper prompt. */
    names?: string[]
    /** Her Claude key: the Opus 5.5 spelling pass against the script. Without it only the deterministic pass runs. */
    anthropicKey?: string | null
  } = {},
): Promise<Transcript> {
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
    const prompt = [opts.names?.length ? opts.names.join(", ") : "", opts.script ?? ""].filter(Boolean).join("\n")
    const t = await transcribeAudio(openaiKey, await fs.readFile(audio), "he", prompt)
    // Starts snapped to where her voice really comes back (free — from the same audio).
    let words = snapWordsToVoice(t.words, voiceOnsets(await audioLevels(audio)))
    // Spelling from the script: the safe deterministic pass, then Opus 5.5.
    if (opts.script?.trim()) {
      words = alignToScript(words, opts.script)
      if (opts.anthropicKey) words = await correctWithScript(opts.anthropicKey, words, opts.script).catch(() => words)
    }
    return { ...t, words }
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}


/* ----------------------------- voice onsets ----------------------------- */

/** Loudness of the audio in dB, one value per 20ms (mono 16kHz PCM via ffmpeg). */
export function audioLevels(audioPath: string): Promise<number[]> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("ffmpeg binary not found"))
    const proc = spawn(ffmpegPath as unknown as string, ["-v", "error", "-i", audioPath, "-ac", "1", "-ar", "16000", "-f", "s16le", "-"])
    const chunks: Buffer[] = []
    proc.stdout.on("data", (d: Buffer) => chunks.push(d))
    proc.on("error", reject)
    proc.on("close", () => {
      const pcm = Buffer.concat(chunks)
      const win = 320 // 20ms at 16kHz
      const out: number[] = []
      for (let i = 0; i + win * 2 <= pcm.length; i += win * 2) {
        let sum = 0
        for (let j = 0; j < win; j++) {
          const v = pcm.readInt16LE(i + j * 2) / 32768
          sum += v * v
        }
        out.push(20 * Math.log10(Math.sqrt(sum / win) + 1e-9))
      }
      resolve(out)
    })
  })
}

/**
 * The moments her voice starts after a silence (seconds). Silence is
 * relative to the clip's own noise floor (its quietest tenth), so a room
 * tone or quiet music doesn't count as speech.
 */
export function voiceOnsets(levels: number[], frameSec = 0.02, minSilence = 0.25): number[] {
  if (!levels.length) return []
  const sorted = [...levels].sort((a, b) => a - b)
  const floor = sorted[Math.floor(sorted.length * 0.1)]
  const loud = sorted[Math.floor(sorted.length * 0.9)]
  // Voice: well above the floor (and never more than 18dB under the loudest speech).
  const threshold = Math.max(floor + 10, loud - 18)
  const onsets: number[] = []
  let quiet = minSilence / frameSec // the clip's start counts as after a silence
  for (let i = 0; i < levels.length; i++) {
    if (levels[i] >= threshold) {
      if (quiet * frameSec >= minSilence) onsets.push(i * frameSec)
      quiet = 0
    } else quiet++
  }
  return onsets
}

/**
 * A word stamped while she is still silent (Whisper starts a word up to
 * ~0.4s early after a pause, and the first word at 0) starts when her voice
 * comes back — never past the word's own end, never earlier than stamped.
 */
export function snapWordsToVoice(words: Word[], onsets: number[], reach = 0.6): Word[] {
  return words.map((w) => {
    const onset = onsets.find((o) => o > w.start && o - w.start <= reach && o < w.end - 0.05)
    return onset === undefined ? w : { ...w, start: Number(onset.toFixed(2)) }
  })
}

/* --------------------------- spelling from the script --------------------------- */

const letters = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, "")

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}

/**
 * Deterministic spelling pass: a word is respelled to the script's word only
 * when she is clearly saying the script there — its neighbours match the
 * script's neighbours exactly — and the two spellings are close. Times and
 * order never change; a clip that doesn't follow the script is left as is.
 */
export function alignToScript(words: Word[], script: string): Word[] {
  const tokens = script.split(/\s+/).filter(Boolean)
  const keys = tokens.map(letters)
  const out = words.map((w) => ({ ...w }))
  for (let i = 0; i < out.length; i++) {
    const w = letters(out[i].text)
    if (!w || keys.includes(w)) continue
    const prev = i > 0 ? letters(out[i - 1].text) : null
    const next = i < out.length - 1 ? letters(out[i + 1].text) : null
    for (let k = 0; k < tokens.length; k++) {
      const leftOk = prev === null ? k === 0 : k > 0 && keys[k - 1] === prev
      const rightOk = next === null ? k === tokens.length - 1 : k < tokens.length - 1 && keys[k + 1] === next
      if (!leftOk || !rightOk) continue
      const key = keys[k]
      if (key.length >= 2 && distance(w, key) <= Math.max(1, Math.floor(key.length * 0.4))) {
        // The script's spelling, with the punctuation she already had.
        out[i].text = out[i].text.replace(letters(out[i].text) ? new RegExp(`[\\p{L}\\p{N}]+`, "u") : /$/, key)
        break
      }
    }
  }
  return out
}

/** The Opus pass's answer, applied safely: only listed words, only their spelling. */
export function applySpellingFixes(words: Word[], fixes: { i: number; text: string }[]): Word[] {
  const out = words.map((w) => ({ ...w }))
  for (const f of fixes) {
    if (!Number.isInteger(f.i) || f.i < 0 || f.i >= out.length) continue
    const text = String(f.text ?? "").trim()
    if (!text || text.split(/\s+/).length > 3) continue
    out[f.i].text = text
  }
  return out
}

/**
 * Opus 5.5 spelling pass (her Claude key): names and terms she says that
 * Whisper misheard are respelled the way the script writes them. One word in,
 * one word out — never times, never order, never a word she didn't say.
 */
export async function correctWithScript(anthropicKey: string, words: Word[], script: string): Promise<Word[]> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default
  const client = new Anthropic({ apiKey: anthropicKey })
  const msg = await client.messages.create({
    model: TALKING_HEAD_MODEL,
    max_tokens: 2000,
    system:
      "You fix the spelling of a Hebrew speech transcript against the speaker's own script. Reply with JSON only.",
    messages: [
      {
        role: "user",
        content: [
          "SCRIPT (what she meant to say; she may deviate):",
          script.slice(0, 6000),
          "",
          "TRANSCRIPT WORDS (index: word):",
          words.map((w, i) => `${i}: ${w.text}`).join("\n"),
          "",
          'Return {"fixes":[{"i":index,"text":"spelling"}]} for words that are the SAME spoken word as one in the script but spelled or heard wrong (names, brands, English terms, typos). Keep each word one-for-one: never merge, split, add, drop or reorder words. Leave every word that is fine, or that she said differently from the script, unchanged. Empty list when nothing needs fixing.',
        ].join("\n"),
      },
    ],
  })
  const text = msg.content.map((c) => (c.type === "text" ? c.text : "")).join("")
  const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { fixes?: { i: number; text: string }[] }
  return applySpellingFixes(words, json.fixes ?? [])
}
