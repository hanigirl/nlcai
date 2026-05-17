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

  if (name.endsWith(".rtf")) {
    return {
      kind: "unsupported",
      message: "פורמט RTF לא נתמך. שמרו את הקובץ כ-docx או טקסט ונסו שוב.",
    }
  }

  return { kind: "unsupported", message: "פורמט לא נתמך. תומכים ב-pdf, docx, doc, txt, md." }
}
