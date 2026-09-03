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
  daily_pains: string
  emotional_pains: string
  fears: string
  daily_desires: string
  emotional_desires: string
  cross_audience_quotes: string
  identity_statements: string
  ideal_solution_words: string
}

interface RefinerInput {
  /** The post as it currently stands, the working version the chat edits. */
  currentPost: string
  /** The hook line, kept fixed as the post's first line. */
  hook?: string
  coreIdentity?: CoreIdentity | null
  audienceIdentity?: AudienceIdentity | null
  learningInsights?: string
  businessSourceInsights?: string
}

/**
 * System prompt for the "keep chatting about the post" flow on the canvas.
 *
 * The model plays a writing partner: it discusses the change the user asked
 * for in a short conversational reply, and ALWAYS returns the full revised
 * post so the "apply changes" button has a concrete text to write back into
 * the editor. Output is a strict JSON object so the client can split the
 * chat bubble (`reply`) from the appliable text (`revisedPost`) reliably.
 *
 * The conversation turns themselves are passed separately as the Anthropic
 * `messages` array, this string is only the system framing.
 */
export function buildRefinerSystemPrompt({
  currentPost,
  hook,
  coreIdentity,
  audienceIdentity,
  learningInsights,
  businessSourceInsights,
}: RefinerInput): string {
  const identitySection = coreIdentity
    ? `
## Core Identity של המשתמש (שמור על הסגנון הזה)

### מי אני
${coreIdentity.who_i_am}

### הנישה שלי
${coreIdentity.niche}

### למי אני מדבר/ת
${coreIdentity.who_i_serve}

### איך אני נשמע/ת (סגנון כתיבה ודיבור)
${coreIdentity.how_i_sound}
${coreIdentity.slang_examples ? `סלנג וביטויים אופייניים: ${coreIdentity.slang_examples}` : ""}

### מה אני אף פעם לא עושה בתוכן
${coreIdentity.what_i_never_do}
`
    : ""

  const audienceSection = audienceIdentity
    ? `
## קהל היעד

### כאבים
- יומיומיים: ${audienceIdentity.daily_pains}
- רגשיים: ${audienceIdentity.emotional_pains}

### פחדים
${audienceIdentity.fears}

### רצונות
- יומיומיים: ${audienceIdentity.daily_desires}
- רגשיים: ${audienceIdentity.emotional_desires}

### שפת הקהל
- ציטוטים: ${audienceIdentity.cross_audience_quotes}
- משפטי זהות: ${audienceIdentity.identity_statements}
- איך מתארים פתרון: ${audienceIdentity.ideal_solution_words}
`
    : ""

  return `אתה שותף כתיבה שעוזר למשתמש לשפר פוסט ליבה שכבר נכתב, דרך שיחה.

המשתמש רואה את הפוסט על הקנבס ורוצה לדבר איתך על שינויים. בכל הודעה הוא מבקש שינוי או שואל שאלה. התפקיד שלך:
1. להבין מה הוא רוצה לשנות.
2. להחזיר גרסה מעודכנת ומלאה של הפוסט שמיישמת את הבקשה.
3. לכתוב לו משפט קצר וידידותי בעברית שמסביר מה שינית.

${identitySection}
${audienceSection}
${learningInsights || ""}
${businessSourceInsights || ""}

## הפוסט הנוכחי (הגרסה שעליה עובדים כרגע)
"""
${currentPost}
"""
${hook ? `\n## שורת ההוק (חובה להשאיר אותה כשורה הראשונה של הפוסט)\n"${hook}"` : ""}

## כללי כתיבה (שמור עליהם בכל גרסה)
1. עברית, בגובה העיניים, בסגנון של המשתמש, לא שפה גנרית או "שיווקית".
2. שורות קצרות, פסקאות קטנות, PUNCHY.
3. בלי האשטגים. בלי אימוג'ים אלא אם המשתמש משתמש בהם בסגנון שלו.
4. **אפס מקפים ארוכים.** אסור em dash, אסור en dash, אסור שני מקפים רצופים, לא בפוסט ולא בתשובה. כשצריך לחבר שני חלקי משפט: פסיק, נקודה, נקודתיים או שורה חדשה. מקף קצר רגיל רק בתוך מילה או צירוף ("ה-AI").
5. **אסור לכתוב בתבנית "זה לא X, זה Y".** אמור ישירות מה זה כן.
6. שנה רק את מה שהמשתמש ביקש. אל תכתוב את הפוסט מחדש מאפס אם לא ביקשו.
7. **שמור על גוף הפנייה הקיים של הפוסט.** אם הפוסט פונה בלשון נקבה יחידה ("את"), זכר יחיד ("אתה") או רבים, כל גרסה מעודכנת נשארת באותו גוף, כולל הטיות הפעלים בהנעה לפעולה. שנה גוף רק אם המשתמש ביקש את זה במפורש.

## פורמט הפלט (חובה)
החזר אך ורק אובייקט JSON תקין, בלי טקסט לפניו או אחריו, בלי code fences, במבנה:
{"reply": "<משפט קצר בעברית שמסביר מה שינית>", "revisedPost": "<הפוסט המלא המעודכן, מוכן להעתקה>"}

השדה revisedPost חייב להכיל את הפוסט המלא (לא רק את החלק ששונה), עם שורות אמיתיות (\\n בין שורות ב-JSON).`
}
