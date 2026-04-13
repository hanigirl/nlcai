import { GREAT_HOOKS_EXAMPLES } from "./great-hooks"

interface CoreIdentity {
  who_i_am: string
  who_i_serve: string
  how_i_sound: string
  slang_examples: string
  what_i_never_do: string
  product_name: string
  niche: string
}

interface AudienceIdentity {
  location: string
  employment: string
  education: string
  income: string
  behavioral: string
  awareness_level: string
  daily_pains: string
  emotional_pains: string
  unresolved_consequences: string
  fears: string
  failed_solutions: string
  limiting_beliefs: string
  myths: string
  daily_desires: string
  emotional_desires: string
  small_wins: string
  ideal_solution: string
  bottom_line: string
  cross_audience_quotes: string
  ideal_solution_words: string
  identity_statements: string
}

interface HookGeneratorInput {
  idea: string
  userResponse?: string
  productName?: string
  coreIdentity?: CoreIdentity | null
  audienceIdentity?: AudienceIdentity | null
  count?: number
  learningInsights?: string
  trendContext?: string
}

export function buildHookGeneratorPrompt({
  idea,
  userResponse,
  productName,
  coreIdentity,
  audienceIdentity,
  count = 3,
  learningInsights,
  trendContext,
}: HookGeneratorInput): string {
  const identitySection = coreIdentity
    ? `
## Core Identity של המשתמש

### מי אני
${coreIdentity.who_i_am}

### הנישה שלי
${coreIdentity.niche}

### למי אני מדבר/ת
${coreIdentity.who_i_serve}

### איך אני נשמע/ת
${coreIdentity.how_i_sound}
${coreIdentity.slang_examples ? `סלנג ודוגמאות: ${coreIdentity.slang_examples}` : ""}

### מה אני אף פעם לא עושה
${coreIdentity.what_i_never_do}
`
    : ""

  const audienceSection = audienceIdentity
    ? `
## Audience Identity — קהל היעד

### דמוגרפיה
- מיקום: ${audienceIdentity.location}
- תעסוקה: ${audienceIdentity.employment}
- השכלה: ${audienceIdentity.education}
- הכנסה: ${audienceIdentity.income}
- התנהגות: ${audienceIdentity.behavioral}
- רמת מודעות: ${audienceIdentity.awareness_level}

### כאבים ובעיות
- כאבים יומיומיים: ${audienceIdentity.daily_pains}
- כאבים רגשיים: ${audienceIdentity.emotional_pains}
- מה יקרה אם לא נפתר: ${audienceIdentity.unresolved_consequences}

### פחדים
${audienceIdentity.fears}

### פתרונות כושלים מהעבר
${audienceIdentity.failed_solutions}

### אמונות מגבילות
${audienceIdentity.limiting_beliefs}

### מיתוסים
${audienceIdentity.myths}

### רצונות וחלומות
- רצונות יומיומיים: ${audienceIdentity.daily_desires}
- רצונות רגשיים: ${audienceIdentity.emotional_desires}
- ניצחונות קטנים: ${audienceIdentity.small_wins}
- הפתרון האידיאלי: ${audienceIdentity.ideal_solution}
- בשורה התחתונה: ${audienceIdentity.bottom_line}

### שפת הקהל
- ציטוטים חוצי-קהל: ${audienceIdentity.cross_audience_quotes}
- איך הם מתארים את הפתרון: ${audienceIdentity.ideal_solution_words}
- משפטי זהות: ${audienceIdentity.identity_statements}
`
    : ""

  const product = productName || coreIdentity?.product_name || ""

  return `אתה סוכן מומחה ביצירת הוקים ויראליים לתוכן קצר (Shorts, Reels, TikTok).

## המשימה שלך
קח את **הרעיון של המשתמש** — זה הנושא המרכזי! כל ההוקים חייבים להיות **על הרעיון הזה ורק עליו**.
${userResponse ? "התייחס גם לתיאור שהמשתמש נתן." : ""}${product ? ` שלב את המוצר "${product}" בצורה טבעית.` : ""}
צור ${count} הוקים ויראליים שמדברים בקול ובשפה של המשתמש, מותאמים לקהל היעד שלו.
**כל הוק חייב לגעת בזווית אחרת של הרעיון** — אל תחזור על אותה זווית פעמיים.

${identitySection}
${audienceSection}

## ⭐ הרעיון של המשתמש (זה המוקד! כל ההוקים חייבים להיות על הנושא הזה!)
${idea}

${userResponse ? `## מה המשתמש רוצה להגיד על זה\n${userResponse}` : ""}

${product ? `## המוצר שהמשתמש מקדם\n${product}` : ""}

${trendContext ? `## מחקר משלים מהרשת (השתמש רק אם רלוונטי לרעיון למעלה!):\n${trendContext}\n` : ""}

## כללי משחק (לא ניתן לעקוף)
**כל הוק חייב להיות התאמה ישירה של תבנית מהמאגר למטה.** אסור להמציא תבנית חדשה. אם תבנית לא מתאימה לרעיון — תבחר אחרת מהמאגר. *לעולם אל תכתוב הוק בלי שיש לו תבנית מקור ברורה.*

## הנחיות
1. **כל ההוקים על הרעיון של המשתמש** — הרעיון הוא הנושא המרכזי. מחקר מהרשת רק להעשיר עם פרטים ספציפיים (שמות כלים, מספרים, שיטות).
2. **ציין שמות ספציפיים!** לא "כלי AI חדש" אלא "Figma AI". לא "טרנד" אלא השם הקונקרטי.
3. **${count} הוקים = ${count} תבניות שונות** — אל תחזור על אותה תבנית פעמיים. גוון בין קטגוריות (מודעות / חיבור / אוטוריטה).
4. **דייק NATIVE עברית** — אל תשתמש במילים מתורגמות מאנגלית. ישראלי אומר "אמאלה" ולא "וואו", "תותח/חבל על הזמן" ולא "מדהים", "מתה על זה" ולא "excited".
5. הוקים בסגנון טיקטוקי/שורטס — מבטיחים טריק, סוד, קיצור דרך.
6. קצרים ופאנצ'יים — משפט אחד עד שניים.
7. השתמש בטון של המשתמש לפי ה-Core Identity.
8. אל תשתמש בדפוסים שהמשתמש ציין ב"מה אני אף פעם לא עושה".
9. **אסור להחליף נושא** — אם הרעיון על X, כל ההוקים על X.

## מאגר התבניות (חובה לבחור מתוכן בלבד):
${GREAT_HOOKS_EXAMPLES}

${learningInsights || ""}
## פלט
החזר בדיוק ${count} הוקים, כל אחד בשורה אחת בלבד.
כל הוק חייב להיות משפט שלם ומוגמר — אסור שהוק ייקטע באמצע.
אל תוסיף מספור, תבליטים, מקפים, או הסברים — רק את הטקסט של ההוק עצמו.
אל תשבור הוק ל-2 שורות — הכל בשורה אחת.`
}

export function parseHooks(response: string, count = 3): string[] {
  return response
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 10)
    .filter((line) => !line.startsWith("#") && !line.startsWith("-") && !line.startsWith("*"))
    .map((line) => line.replace(/^\d+[\.\)]\s*/, ""))
    .slice(0, count)
}
