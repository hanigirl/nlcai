// Client-side guards before posting to /api/parse-identity. Catches the most
// common "user is about to wait 30s for a server-side rejection" cases:
// oversized files, unsupported formats, empty files. Keeps Hebrew error
// messages in one place so onboarding and settings stay consistent.
//
// Vercel serverless body limit is 4.5MB by default — we cap at 4MB to leave
// margin for FormData overhead. Anything larger never reaches the route.

const MAX_BYTES = 4 * 1024 * 1024
const SUPPORTED_EXTENSIONS = [".docx", ".doc", ".txt", ".md", ".rtf"] as const

export interface FileValidationError {
  message: string
}

export function validateIdentityFile(file: File): FileValidationError | null {
  const name = file.name.toLowerCase()

  if (file.size === 0) {
    return { message: "הקובץ ריק. בדקו אותו ונסו להעלות שוב." }
  }

  if (/\.pdf$/i.test(name) || file.type === "application/pdf") {
    return { message: "אי אפשר להעלות קבצי PDF. שמרו אותם כ-docx או טקסט ונסו שוב." }
  }

  const hasSupportedExt = SUPPORTED_EXTENSIONS.some((ext) => name.endsWith(ext))
  if (!hasSupportedExt) {
    return {
      message: `סוג הקובץ לא נתמך. תומכים ב-${SUPPORTED_EXTENSIONS.join(", ")} בלבד.`,
    }
  }

  if (file.size > MAX_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1)
    const limitMb = (MAX_BYTES / 1024 / 1024).toFixed(0)
    return {
      message: `הקובץ גדול מדי (${mb} MB). הגודל המקסימלי הוא ${limitMb} MB. הקטינו את הקובץ או הסירו תמונות מתוכו ונסו שוב.`,
    }
  }

  return null
}
