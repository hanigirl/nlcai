// Translates Anthropic SDK errors (and our own internal codes) into a clear
// Hebrew message users can act on. Falls back to the original message so we
// never lose information.

const PATTERNS: Array<{ test: (m: string) => boolean; message: string }> = [
  {
    test: (m) => /credit balance is too low/i.test(m),
    message:
      "אין יתרה בחשבון Anthropic שלכם. הוסיפו credits ב-console.anthropic.com → Plans & Billing ונסו שוב.",
  },
  {
    test: (m) =>
      /invalid x-api-key|authentication.*fail|invalid api key|401/i.test(m),
    message:
      "מפתח Anthropic לא תקין או שפג תוקפו. עדכנו אותו בהגדרות → חיבור חשבונות.",
  },
  {
    test: (m) => /rate.?limit|429/i.test(m),
    message: "חרגנו ממגבלת הקצב של Anthropic. נסו שוב בעוד דקה.",
  },
  {
    test: (m) => /overloaded|529/i.test(m),
    message: "השירות של Anthropic עמוס כרגע. נסו שוב בעוד מספר רגעים.",
  },
  {
    test: (m) => /timeout|timed out/i.test(m),
    message: "הקריאה ל-Anthropic לקחה יותר מדי זמן. נסו שוב.",
  },
  {
    // Our own per-call AbortSignal.timeout fired before the parse finished.
    // The row gets persisted with whatever we extracted (often nothing), and
    // the gap popup picks up the missing fields for manual completion.
    test: (m) => /^ai_timeout$|request was aborted|aborted/i.test(m),
    message:
      "הניתוח לקח יותר מדי זמן. אפשר להשלים את הפרטים ידנית בפופאפ שייפתח, או לנסות שוב עם קובץ קצר יותר.",
  },
  {
    test: (m) =>
      /^anthropic_not_connected$|claude api key not connected/i.test(m),
    message: "מפתח Claude לא מחובר. חברו אותו בהגדרות → חיבור חשבונות.",
  },
  {
    test: (m) => /no_json_block_in_response|json/i.test(m),
    message:
      "Claude החזיר תשובה שלא הצלחנו לפרסר. נסו להעלות שוב את הקובץ; אם הבעיה חוזרת, ייתכן שהקובץ ריק או לא קריא.",
  },
  {
    // Primary parse + Sonnet retry both left the 5 critical pain/fear/desire
    // fields empty. Usually means the upload is wrong (style file uploaded
    // as audience, template with no real content, single-line stub).
    test: (m) => /^critical_fields_empty$/i.test(m),
    message:
      "לא הצלחנו לחלץ מהקובץ את הכאבים, הפחדים והרצונות של הקהל. ודאו שהעליתם את ניתוח הקהל הנכון (לא קובץ סגנון/תבנית ריקה), או מלאו את השדות ידנית בפופאפ שייפתח.",
  },
]

export function anthropicErrorToHebrew(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "")
  for (const p of PATTERNS) {
    if (p.test(raw)) return p.message
  }
  return raw
    ? `שגיאה לא צפויה מ-Anthropic: ${raw}`
    : "שגיאה לא ידועה. נסו שוב."
}
