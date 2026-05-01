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
    test: (m) =>
      /^anthropic_not_connected$|claude api key not connected/i.test(m),
    message: "מפתח Claude לא מחובר. חברו אותו בהגדרות → חיבור חשבונות.",
  },
  {
    test: (m) => /no_json_block_in_response|json/i.test(m),
    message:
      "Claude החזיר תשובה שלא הצלחנו לפרסר. נסו להעלות שוב את הקובץ; אם הבעיה חוזרת, ייתכן שהקובץ ריק או לא קריא.",
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
