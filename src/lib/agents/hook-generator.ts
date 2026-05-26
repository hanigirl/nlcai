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

## מה הופך הוק לטוב — שלוש העמודות
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
8. **פניה לקהל תמיד ברבים** (אתם/לכם/שלכם/תעשו/תצפו/אתם עושים). אסור להשתמש בלשון נקבה יחיד (את/לך/שלך/תעשי/מתה על זה) או זכר יחיד (אתה/תעשה). גם אם התבנית במאגר או דוגמה בנקבה יחיד — המר/י אותה לרבים בהוק הסופי.

## מאגר תבניות לעזר (לא חובה!)
התבניות למטה הן השראה ומסגרות שעובדות — מותר לבחור מהן, ומותר *לא* לבחור. אם יש לך זווית או ניסוח חזק יותר שמתאים יותר לסיטואציה הזו — כתוב אותו ישירות. **המבחן היחיד הוא שלוש העמודות (כאב + סקרנות + פאנץ׳ נסגר)**. תבנית שלא מצליחה לעמוד בשלוש העמודות לזווית הזו — אל תכופף אליה את ההוק.

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
