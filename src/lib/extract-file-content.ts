import mammoth from "mammoth"
import WordExtractor from "word-extractor"

export type FileContent =
  | { kind: "text"; text: string }
  | { kind: "pdf"; base64: string }
  | { kind: "unsupported"; message: string }

export async function extractFileContent(
  fileName: string,
  buffer: Buffer
): Promise<FileContent> {
  const name = fileName.toLowerCase()

  if (name.endsWith(".pdf")) {
    return { kind: "pdf", base64: buffer.toString("base64") }
  }

  if (name.endsWith(".docx")) {
    try {
      const result = await mammoth.extractRawText({ buffer })
      const text = result.value?.trim()
      if (!text) {
        return { kind: "unsupported", message: "הקובץ נראה ריק. נסו להעלות שוב." }
      }
      return { kind: "text", text }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { kind: "unsupported", message: `לא הצלחנו לקרוא את קובץ ה-docx (${msg})` }
    }
  }

  if (name.endsWith(".doc")) {
    try {
      const extractor = new WordExtractor()
      const extracted = await extractor.extract(buffer)
      const text = extracted.getBody()?.trim()
      if (!text) {
        return { kind: "unsupported", message: "הקובץ נראה ריק. שמרו אותו כ-docx או pdf ונסו שוב." }
      }
      return { kind: "text", text }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { kind: "unsupported", message: `לא הצלחנו לקרוא את קובץ ה-doc (${msg}). שמרו אותו כ-docx או pdf ונסו שוב.` }
    }
  }

  if (name.endsWith(".txt") || name.endsWith(".md")) {
    const text = buffer.toString("utf8").trim()
    if (!text) {
      return { kind: "unsupported", message: "הקובץ ריק." }
    }
    return { kind: "text", text }
  }

  // Transcript files (Zoom / Meet / Teams captions). Timestamps and cue
  // numbers carry no meaning for content work — strip them to plain speech.
  if (name.endsWith(".vtt") || name.endsWith(".srt")) {
    const text = transcriptToText(buffer.toString("utf8"))
    if (!text) {
      return { kind: "unsupported", message: "קובץ התמלול ריק." }
    }
    return { kind: "text", text }
  }

  if (name.endsWith(".rtf")) {
    return {
      kind: "unsupported",
      message: "פורמט RTF לא נתמך. שמרו את הקובץ כ-docx או טקסט ונסו שוב.",
    }
  }

  return { kind: "unsupported", message: "פורמט לא נתמך. תומכים ב-pdf, docx, doc, txt, md." }
}

/**
 * WebVTT / SRT → plain text. Drops the header, NOTE/STYLE blocks, cue numbers
 * and `00:01:02.000 --> …` timing lines, unwraps `<v Speaker>` voice tags into
 * "Speaker: …", and merges consecutive lines from the same speaker so a
 * 3-hour transcript isn't 5,000 two-word fragments.
 */
export function transcriptToText(raw: string): string {
  const out: string[] = []
  let skipBlock = false
  for (const rawLine of raw.replace(/\r/g, "").split("\n")) {
    const line = rawLine.trim()
    if (!line) {
      skipBlock = false
      continue
    }
    if (skipBlock) continue
    if (/^WEBVTT/i.test(line)) continue
    if (/^(NOTE|STYLE|REGION)\b/.test(line)) {
      skipBlock = true
      continue
    }
    if (/^\d+$/.test(line)) continue
    if (line.includes("-->")) continue
    const text = line
      .replace(/<v\s+([^>]+)>/gi, "$1: ")
      .replace(/<[^>]+>/g, "")
      .trim()
    if (!text) continue
    const speaker = text.match(/^([^:]{1,40}):\s/)?.[1]
    const prev = out[out.length - 1]
    if (speaker && prev?.startsWith(`${speaker}: `)) {
      out[out.length - 1] = `${prev} ${text.slice(speaker.length + 2)}`
    } else if (!speaker && prev && !/[.!?…]$/.test(prev)) {
      out[out.length - 1] = `${prev} ${text}`
    } else {
      out.push(text)
    }
  }
  return out.join("\n").trim()
}
