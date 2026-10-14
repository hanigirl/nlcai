/**
 * The user's own voice, for the one-hook-at-a-time writer.
 *
 * Why this exists (Joey, 2026-10-14 — "[P1] הוקים בענן חלשים לעומת קלוד בדסקטופ"):
 * the homepage/inventory writer received the angle, the learned lessons and
 * the own-name rule — and nothing else. No "how I sound", no slang, and not a
 * single hook the user had written or starred. The planner saw her liked
 * hooks, but only as a do-not-repeat list. So the model that actually wrote
 * the sentence had never heard her talk, and filled the gap with the
 * translated-from-English register Nataliya called out.
 *
 * Claude on the desktop writes better mostly because the user pastes her own
 * examples into the conversation. This hands the writer the same thing.
 *
 * Rules carried in the copy: the examples teach FORM (rhythm, length, words,
 * warmth), never topics — topics are the planner's job, and the liked hooks
 * are already on its do-not-repeat list.
 */

export interface HookVoiceInput {
  howISound?: string | null
  slangExamples?: string | null
  whatINeverDo?: string | null
  /** Hooks she wrote, imported, starred or turned into a post — newest first. */
  likedHooks?: string[]
  /** How many examples to show. Eight is enough to hear a voice. */
  maxExamples?: number
}

export function buildHookVoiceSection({
  howISound,
  slangExamples,
  whatINeverDo,
  likedHooks = [],
  maxExamples = 8,
}: HookVoiceInput): string {
  const sound = howISound?.trim()
  const slang = slangExamples?.trim()
  const never = whatINeverDo?.trim()
  const examples = likedHooks
    .map((h) => h?.trim())
    .filter((h): h is string => !!h)
    .slice(0, maxExamples)

  if (!sound && !slang && !never && examples.length === 0) return ""

  const lines: string[] = ["## הקול של המשתמש — ההוק חייב להישמע כמו שהוא/היא מדבר/ת"]
  if (sound) lines.push(`- **איך אני נשמע/ת:** ${sound}`)
  if (slang) lines.push(`- **ביטויים שלי:** ${slang}`)
  if (never) lines.push(`- **מה אני אף פעם לא עושה:** ${never}`)

  if (examples.length > 0) {
    lines.push(
      "",
      "### הוקים שהמשתמש כתב או אהב — ככה נשמע הקול שלו/ה",
      "קחו מהם את הקצב, אורך המשפט, המילים, הפנייה והחום. **לא** את הנושא ולא את המבנה מילה במילה — הנושא מגיע מהזווית למעלה.",
      ...examples.map((h, i) => `${i + 1}. ${h}`),
      "",
      "**המבחן:** אם תשימו את ההוק החדש בין הדוגמאות האלה — הוא צריך להיראות כאילו אותו אדם כתב את כולם. אם הוא נשמע כמו כותרת מתורגמת לידן — שכתבו.",
    )
  }

  return `\n${lines.join("\n")}\n`
}
