// Translates Supabase Storage / Postgres / network errors into a clear Hebrew
// message users can act on. The goal: when an upload fails, the user sees
// exactly *what* failed and *what to do next* — never a silent failure or a
// raw English Supabase string.
//
// Returns both a category (for telemetry/logic) and a Hebrew message (for UI).

export type UploadErrorKind =
  | "auth_expired"
  | "rls_denied"
  | "quota_exceeded"
  | "payload_too_large"
  | "duplicate_path"
  | "bucket_missing"
  | "network"
  | "timeout"
  | "db_constraint"
  | "unknown"

export interface ClassifiedUploadError {
  kind: UploadErrorKind
  message: string
  raw: string
}

const PATTERNS: Array<{
  kind: UploadErrorKind
  test: (m: string) => boolean
  message: string
}> = [
  {
    kind: "auth_expired",
    test: (m) => /jwt|jwsexpired|invalid.*token|not.*authenticated|401/i.test(m),
    message:
      "פג תוקף ההתחברות. רעננו את הדף, התחברו מחדש ונסו להעלות שוב.",
  },
  {
    kind: "rls_denied",
    test: (m) =>
      /row.?level security|rls|permission denied|403|not authorized/i.test(m),
    message:
      "אין הרשאה לשמור את הקובץ. אם הבעיה חוזרת — צרו קשר עם התמיכה (RLS denial).",
  },
  {
    kind: "quota_exceeded",
    test: (m) => /quota|storage.*full|insufficient.*storage|507/i.test(m),
    message:
      "אין מקום פנוי באחסון. מחקו קבצים ישנים בהגדרות → מדיה ונסו שוב.",
  },
  {
    kind: "payload_too_large",
    test: (m) => /payload too large|file size.*exceed|413/i.test(m),
    message:
      "הקובץ גדול מדי לאחסון. הקטינו אותו ונסו שוב.",
  },
  {
    kind: "duplicate_path",
    test: (m) => /already exists|duplicate|409/i.test(m),
    message:
      "כבר קיים קובץ באותו מיקום. רעננו את הדף ונסו שוב.",
  },
  {
    kind: "bucket_missing",
    test: (m) => /bucket not found|invalid bucket/i.test(m),
    message:
      "תקלה בהגדרות האחסון. אנחנו על זה — נסו שוב בעוד מספר דקות.",
  },
  {
    kind: "network",
    test: (m) =>
      /network|fetch failed|enotfound|econnrefused|econnreset|failed to fetch/i.test(
        m
      ),
    message:
      "נראה שהחיבור לאינטרנט נקטע באמצע ההעלאה. בדקו את החיבור ונסו שוב.",
  },
  {
    kind: "timeout",
    test: (m) => /timeout|timed out|etimedout|abort/i.test(m),
    message:
      "ההעלאה לקחה יותר מדי זמן. נסו שוב, ואם הקובץ גדול — הקטינו אותו.",
  },
  {
    kind: "db_constraint",
    test: (m) =>
      /violates.*constraint|null value.*not-null|invalid input syntax/i.test(m),
    message:
      "תקלה ברישום הקובץ במסד הנתונים. אם הבעיה חוזרת — צרו קשר עם התמיכה.",
  },
]

export function classifyUploadError(err: unknown): ClassifiedUploadError {
  const raw = err instanceof Error ? err.message : String(err ?? "")
  for (const p of PATTERNS) {
    if (p.test(raw)) return { kind: p.kind, message: p.message, raw }
  }
  return {
    kind: "unknown",
    message: raw
      ? `שמירת הקובץ נכשלה: ${raw}`
      : "שמירת הקובץ נכשלה מסיבה לא ידועה. נסו שוב.",
    raw,
  }
}
