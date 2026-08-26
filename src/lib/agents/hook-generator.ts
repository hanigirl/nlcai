import { GREAT_HOOKS_EXAMPLES } from "./great-hooks"
import { TEMPLATE_LIBRARY } from "./hook-templates"

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
  employment: string
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
  hasFavorites?: boolean
  /**
   * How the user's idea/description addresses the reader, detected in code
   * (see detect-addressing.ts). When set — hard requirement. When null —
   * derive from the audience (singular), plural only as a last resort.
   */
  addressGender?: "masculine" | "feminine" | "plural" | null
  /**
   * Hooks this user has already been shown — the rejected batch for this idea
   * first, then their other recent hooks. Without it every regenerate ran an
   * identical prompt and produced identical angles.
   */
  previousHooks?: string[]
}

const ADDRESS_GENDER_LABEL: Record<string, string> = {
  masculine: "זכר יחיד",
  feminine: "נקבה יחידה",
  plural: "לשון רבים",
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
  hasFavorites,
  previousHooks,
  // addressGender is deliberately absent: the addressing rule moved into
  // buildHookGeneratorSystem with the rest of the instructions.
}: HookGeneratorInput): string {
  // The batch the user just threw away, spelled out. A soft "don't repeat
  // yourself" does nothing when the model can't see what it already wrote —
  // it has to be shown the actual sentences.
  const previousSection = previousHooks && previousHooks.length > 0
    ? `
## 🚫 הוקים שכבר הצגנו למשתמש — אסור לחזור עליהם
המשתמש כבר ראה את ההוקים האלה ולא בחר באף אחד מהם. הוא לחץ "תייצר מחדש" כדי לקבל **משהו אחר**, לא ניסוח אחר לאותו דבר.

${previousHooks.map((h, i) => `${i + 1}. ${h}`).join("\n")}

**איך בודקים**: לפני שאתה מחזיר הוק, עבור על הרשימה למעלה. אם ההוק החדש נשען על **אותה זווית**, **אותו כאב**, **אותה הבטחה** או **אותו מבנה משפט** כמו אחד מהם — הוא נחשב חזרה, גם אם המילים שונות לגמרי. תזרוק אותו ותכתוב זווית אחרת.
`
    : ""

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

### מי הם
- תעסוקה: ${audienceIdentity.employment}
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

${trendContext ? `## מחקר מהשטח — תוכן שהמשתמש חשוף אליו כבר
הסקשן הזה מחולק לרעיונות מועדפים (⭐ — המשתמש סימן אותם), תוכן ויראלי מהיוצרים שלו (🔥), וטרנדים בנישה (📈). **כשרעיון מועדף או תוכן ויראלי מתכתב עם הרעיון למעלה — השתמש בו ככה ישירות לזווית של ההוק**, לא רק כרקע. אם הרעיון ב-⭐ נוגע באותו נושא של הרעיון הראשי, ההוק יכול לצטט/לענות/לאתגר את הזווית שהיוצר האחר הביא.
${hasFavorites ? "⚠️ **יש למשתמש רעיונות מועדפים** — אם לפחות אחד מהם נוגע בנושא של הרעיון הראשי, חובה להשתמש בו לפחות באחד מההוקים.\n" : ""}
${trendContext}
` : ""}

${previousSection}${learningInsights || ""}`
}

/**
 * The half of the writer prompt that never changes: the quality bar, the
 * rules, the category list, the template library and the worked examples.
 * ~10k tokens — the single largest reusable block in the app, and it used to
 * be re-sent in full on every generate because it sat at the BOTTOM of one
 * giant string, behind the idea. A prompt cache matches on the prefix, so
 * anything positioned after a varying idea can never be cached however stable
 * it is. Living in `system` puts it in front of everything volatile.
 *
 * Only `count` and `addressGender` may be interpolated here, and both hold
 * still across a session. Do NOT add anything per-idea: one interpolated idea
 * and the cache stops hitting, with no error and no signal but the bill.
 */
export function buildHookGeneratorSystem({
  count = 3,
  addressGender,
}: Pick<HookGeneratorInput, "count" | "addressGender">): string {
  // Derived from the max-2-per-category rule below rather than picked: with
  // ten hooks and a ceiling of two each, anything under five categories is a
  // rule the model cannot satisfy, and an impossible instruction gets ignored
  // wholesale rather than partially obeyed.
  const minCategories = Math.min(TEMPLATE_LIBRARY.length, Math.max(3, Math.ceil(count / 2)))
  const categoriesCatalog = TEMPLATE_LIBRARY
    .map((g) => `- ${g.category} ("${g.label}"): ${g.goal}`)
    .join("\n")

  return `## מה הופך הוק לטוב — שלוש העמודות
ההוק חייב להחזיק את כל השלוש. תבניות הן רק כלי עזר; אם יש לך ניסוח חזק יותר שעומד בשלוש העמודות — לך עליו.

### 1. נוגע בכאב/רצון ספציפי של הקהל
לא כאב גנרי. כאב ספציפי שמופיע במחקר הקהל — הקורא חייב להרגיש "זה אני, זה בדיוק מה שעובר עליי". אם ההוק יכול להישלח לכל אדם במדינה — הוא לא חד מספיק.

### 2. מעורר סקרנות אמיתית
ההוק יוצר לולאה פתוחה במוח של הקורא. שאלה שדורשת תשובה, הבטחה שדורשת אימות, סתירה שדורשת הסבר. הקורא חייב להרגיש *צורך* לדעת מה הלאה — לא רק "אה מעניין".

### 3. הפאנץ׳ **לא** בתוך ההוק
זה הכלל הקריטי ביותר. ההוק **מבטיח** ערך — לא **מוסר** אותו. אם אחרי קריאת ההוק הקורא כבר יודע את התובנה/התשובה/הטיפ — אין שום סיבה לצפות בסרטון.
- ❌ "מעצבים שמפחדים מ-AI מפספסים מה שהוא לא יכול לעשות" — התזה כבר שם, אין מה לחכות לו.
- ✅ "3 דברים שAI עדיין לא יודע לעשות ב-2026" — מבטיח רשימה, לא מוסר אותה.
- ❌ "הסיבה שפוסטים לא מקבלים לייקים זה שהם לא קוראים" — הפאנץ׳ נמסר.
- ✅ "הסיבה האמיתית שהפוסטים שלכם לא מקבלים לייקים — והיא לא מה שחשבתם" — לולאה פתוחה.

**מבחן הפאנץ׳**: אחרי קריאת ההוק לבד, האם הקורא צריך את הסרטון כדי לקבל את הערך? אם הוא יכול לסגור את האפליקציה ולפעול לפי ההוק עצמו — שכתב/י, הפאנץ׳ דלף החוצה.

## הנחיות
1. **כל ההוקים על הרעיון של המשתמש** — הרעיון הוא הנושא המרכזי. מחקר מהרשת רק להעשיר עם פרטים ספציפיים (שמות כלים, מספרים, שיטות).
2. **ציין שמות ספציפיים!** לא "כלי AI חדש" אלא "Figma AI". לא "טרנד" אלא השם הקונקרטי.
3. **עברית "עמך" — יומיומית, קלילה ותקנית, לא תרגום מאנגלית**. לפני כל ניסוח שאל/י: "איך ישראלי באמת אומר את זה בעברית?" אם זה לא זורם על הלשון — שכתב/י. אסור תרגום ישיר מאנגלית (hack/viral/content/game changer/mindset/journey וכו׳) — מצא/י מקבילה יומיומית או נסח/י אחרת. תקני בכתיב אבל בטון של שיחה, לא של מאמר. אם מילה נשמעת כמו תרגום — היא כנראה תרגום.
4. הוקים בסגנון טיקטוקי/שורטס — מבטיחים טריק, סוד, קיצור דרך.
5. קצרים ופאנצ'יים — משפט אחד עד שניים.
6. אל תשתמש בדפוסים שהמשתמש ציין ב"מה אני אף פעם לא עושה".
7. **אסור להחליף נושא** — אם הרעיון על X, כל ההוקים על X.
${addressGender
  ? `8. **פניה לקהל ב${ADDRESS_GENDER_LABEL[addressGender]} בלבד** — כך המשתמש כתב ברעיון/בתיאור שלו, ואתה לא מתקן אותו, גם אם קהל היעד מרמז על מגדר אחר. גם אם תבנית במאגר או דוגמה כתובה בגוף אחר — המר/י אותה ל${ADDRESS_GENDER_LABEL[addressGender]} בהוק הסופי. אסור לערבב גופים באותו הוק.`
  : `8. **גוף הפנייה לקהל** — גזור מקהל היעד (בסעיף למעלה): קהל נשים → פנייה בלשון **נקבה יחידה** (את/לך/תעשי). קהל גברים → פנייה בלשון **זכר יחיד** (אתה/לך/תעשה). **רק אם** אי אפשר לגזור מהקהל מגדר ברור — כתוב ברבים (אתם/לכם). התבניות והדוגמאות במאגר כתובות ברבים — המר/י אותן לגוף שקבעת. אסור לערבב גופים באותו הוק.`}

9. **גיוון קשיח בין הקטגוריות** — ${count} ההוקים חייבים להתפרס על לפחות **${minCategories} קטגוריות שונות** מהרשימה למטה, ואסור יותר מ-2 הוקים באותה קטגוריה. זה תנאי, לא המלצה: בלי זה כל ההוקים נופלים לאותה זווית מובנת מאליה של הרעיון.

## קטגוריות זוויות זמינות
${categoriesCatalog}

## מאגר תבניות לעזר (לא חובה!)
התבניות למטה הן השראה ומסגרות שעובדות — מותר לבחור מהן, ומותר *לא* לבחור. אם יש לך זווית או ניסוח חזק יותר שמתאים יותר לסיטואציה הזו — כתוב אותו ישירות. **המבחן היחיד הוא שלוש העמודות (כאב + סקרנות + פאנץ׳ נסגר)**. תבנית שלא מצליחה לעמוד בשלוש העמודות לזווית הזו — אל תכופף אליה את ההוק.

${GREAT_HOOKS_EXAMPLES}

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
