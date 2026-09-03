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

interface CorePostInput {
  hook: string
  userResponse: string
  productName?: string
  productSummary?: string
  productType?: string
  triggerWord?: string
  coreIdentity?: CoreIdentity | null
  audienceIdentity?: AudienceIdentity | null
  learningInsights?: string
  businessSourceInsights?: string
  /**
   * How the user's draft addresses the reader, detected in code (see
   * detect-addressing.ts). When set, the prompt states it as a hard
   * requirement; when null/undefined, the prompt derives gender from the
   * audience (singular), with plural only as a last resort.
   */
  addressGender?: "masculine" | "feminine" | "plural" | null
}

const PRODUCT_TYPE_LABEL: Record<string, string> = {
  front: "מוצר חזית (כניסה)",
  premium: "מוצר פרימיום",
  lead_magnet: "ליד מגנט (חינמי)",
}

const ADDRESS_GENDER_LABEL: Record<string, string> = {
  masculine: "זכר יחיד",
  feminine: "נקבה יחידה",
  plural: "לשון רבים",
}

export function buildCorePostPrompt({
  hook,
  userResponse,
  productName,
  productSummary,
  productType,
  triggerWord,
  coreIdentity,
  audienceIdentity,
  learningInsights,
  businessSourceInsights,
  addressGender,
}: CorePostInput): string {
  const identitySection = coreIdentity
    ? `
## Core Identity של המשתמש

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

  const product = productName || coreIdentity?.product_name || ""
  const productTypeLabel = productType ? PRODUCT_TYPE_LABEL[productType] : ""
  const productSection = product
    ? `## המוצר/שירות: ${product}${productTypeLabel ? ` (${productTypeLabel})` : ""}${productSummary ? `\n\n### תיאור המוצר\n${productSummary}` : ""}`
    : ""

  return `אתה סוכן מומחה בכתיבת פוסטים קצרים לרשתות חברתיות בעברית.

## המשימה שלך
כתוב פוסט ליבה (Core Post) לרשתות חברתיות.
הפוסט צריך להיות קליל, פשוט וברור.

**חשוב מאוד: אל תכתוב בשפה גנרית.** כתוב בדיוק בסגנון שבו המשתמש מדבר וכותב — קרא בעיון את ה-Core Identity ואת הדוגמאות לסגנון שלו, והשתמש בשפה, בביטויים, ובסלנג שלו.

## הקול של המשתמש — הכלל שגובר על כל השאר

התפקיד שלך הוא **לערוך ולסדר**, לא לנסח מחדש. הטיוטה של המשתמש היא לא חומר גלם שממנו מפיקים תקציר — היא המקור, וגם הניסוח שבה הוא חלק מהתוכן.

- **שמור את המילים היומיומיות שלו כלשונן.** אם הוא כתב "בלגן", "נתקע", "מתפקשש", "אין מצב" — זה נשאר בדיוק ככה. אל תשדרג לניסוח מלוטש יותר ("אתגר", "קושי", "לא אופטימלי"). מילה יומיומית שהוחלפה במילה אסופה היא הנזק הכי גדול שאתה יכול לעשות לפוסט הזה.
- **דוגמאות, סיפורים ותיאורי מקרה נשארים באורך מלא.** הם לא מילוי שאפשר לדחוס — הם בדיוק המקום שבו הקוראת מתחברת. דוגמה שכווצה למשפט וחצי הפסיקה לעבוד. אם משהו חייב להתקצר, שיהיה זה החלק ההסברי, לא הדוגמה.
- **קיצור פירושו להוריד חזרתיות ומילים מיותרות** — לא להחליף משפט חי בתקציר מסודר. אם הורדת מילה של המשתמש, זה צריך להיות כי היא נאמרה כבר, לא כי היא נשמעה לך לא מספיק מקצועית.
- **חוסר סימטריה ופסקה שנשמעת כמו דיבור זה טוב.** אל תיישר את הקצב.

מבחן לפני שאתה מחזיר: אם המשפט הזה יכול היה להופיע אצל כל מותג אחר — הוא שגוי. אם קוראת הייתה חושדת שזה נכתב ב-AI — כנראה החלקת יותר מדי.

${identitySection}
${learningInsights || ""}
${audienceSection}

${productSection}

${addressGender
  ? `## גוף הפנייה (דרישה מחייבת)
המשתמש כתב את הטיוטה שלו בפנייה ב${ADDRESS_GENDER_LABEL[addressGender]}. **כל הפוסט ייכתב בפנייה ב${ADDRESS_GENDER_LABEL[addressGender]}** — גם אם קהל היעד או ההוק מרמזים על מגדר אחר. המשתמש בחר במודע איך לפנות לקהל שלו, ואתה לא מתקן אותו.
זה חל על הפוסט כולו: שורת האוטוריטה, גוף הפוסט, וההנעה לפעולה — כולל הטיות הפעלים (${addressGender === "feminine" ? '"הגיבי", "אשלח לך", "תקבלי"' : addressGender === "masculine" ? '"הגב", "אשלח לך", "תקבל"' : '"הגיבו", "אשלח לכם", "תקבלו"'}).`
  : `## גוף הפנייה (קריטי — קבע אותו לפני שאתה מתחיל לכתוב)
הטיוטה של המשתמש לא פונה לקורא בגוף מסוים, אז גזור את גוף הפנייה מקהל היעד (סעיף "קהל היעד" למעלה):
- קהל נשים → פנייה בלשון **נקבה יחידה** ("את", "תרגישי", "הגיבי").
- קהל גברים → פנייה בלשון **זכר יחיד** ("אתה", "תרגיש", "הגב").
- **רק אם** אי אפשר לגזור מהקהל מגדר ברור — כתוב בלשון רבים.

הגוף שקבעת חל על הפוסט כולו: שורת האוטוריטה, גוף הפוסט, וההנעה לפעולה — כולל הטיות הפעלים ("הגיבי / הגב / הגיבו", "אשלח לך / לכם").`}

## מבנה הפוסט (חובה לעקוב אחרי הסדר הזה בדיוק):

### 1. שורת הוק (שורה ראשונה)
השתמש בדיוק בהוק הזה כשורה הראשונה של הפוסט:
"${hook}"

### 2. שורת אוטוריטה (שורה שנייה)
שורה קצרצרה אחת שמציגה את המשתמש כאוטוריטה בנושא.
צריכה להיות רלוונטית לנושא הפוסט, לא גנרית.
דוגמאות לסגנון: "אחרי 8 שנים בתחום...", "אני עושה את זה כל יום...", "ראיתי את זה אצל מאות לקוחות..."
שורה אחת בלבד, קצרה ופאנצ'ית.

### 3. גוף הפוסט — ערך
זה מה שהמשתמש כתב. **זה הטקסט שאתה עורך, לא נושא שאתה כותב עליו מחדש:**
"${userResponse}"

הנחיות לגוף:
- **המילים שלו קודמות למילים שלך.** ברירת המחדל היא לשמור על הניסוח שלו; שינוי הוא החריג, ורק כשיש סיבה ממשית (חזרתיות, משפט שלא ברור).
- שמור על כל דוגמה, סיפור או מקרה שהוא הביא — באורך שלהם, עם הפרטים הקטנים. הפרטים הקטנים הם מה שגורם לזה להישמע אנושי.
- פסקאות קצרות וקצב נושם — אבל קצב קצר הוא לא סיבה לוותר על תוכן. אם יש הרבה מה לומר, פסקה נוספת עדיפה על משפט שדוחס הכל.
- תן ערך אמיתי — טיפ, תובנה, או נקודת מבט חדשה
- דבר בגובה העיניים, לא מלמעלה
- זה פוסט סושיאל ולא מאמר, אבל **אורך הוא לא הבעיה — שיטוח הוא כן.** פוסט קצת ארוך בקול שלה עדיף על פוסט קצר שנשמע כמו כל אחד.

### 4. הנעה לפעולה (שורה אחרונה)
${triggerWord
  ? `שורה אחת שמבקשת מהקורא להגיב במילה הספציפית "${triggerWord}" בתגובות, ובתמורה הוא יקבל משהו ערכי וספציפי.
${product
  ? `**ההצעה חייבת להתאים למוצר "${product}"** שמתואר למעלה. קרא בעיון את תיאור המוצר וגזור ממנו מה אתה מציע בתגובה למילה "${triggerWord}" — שלח את הדבר הכי קרוב למה שהמוצר נותן (גישה, רשימה, מדריך, הדרכה, שיעור, פרטים נוספים), בנוסח שמרגיש כמו טעימה / שלב ראשון של המוצר ולא כמו ספאם מכירתי.
${productType === "lead_magnet"
  ? `המוצר הוא ליד מגנט — ההצעה היא ה-${product} עצמו (חינם, בתמורה לתגובה).`
  : productType === "front"
    ? `המוצר הוא מוצר חזית — ההצעה צריכה לפתוח שיחה / לתת טעימה שמובילה אל ה-${product} (לא למכור אותו ישירות בשורה אחת).`
    : productType === "premium"
      ? `המוצר הוא פרימיום — אל תמכור אותו בשורה הזו; הצע משהו חינמי וערכי שמתחבר לעולם של ${product} (פרק, מדריך, שיחת ייעוץ קצרה).`
      : ""}
דוגמאות לסגנון (התאם את התוכן שאחרי "${triggerWord}" למוצר; הדוגמאות ברבים — הטה אותן לגוף הפנייה שקבעת):
- הגיבו "${triggerWord}" ואשלח לכם הדרכה מוקלטת על <נושא ספציפי מתוך המוצר>.
- כתבו "${triggerWord}" בתגובות ואצרף אתכם לרשימת ה<שם הרשימה מהמוצר>.
- מי שרוצה את <הדבר הספציפי>, שיכתוב "${triggerWord}" בתגובות.`
  : `בחר משהו ערכי שמתאים לנושא הפוסט (הדרכה מוקלטת, מדריך, פרטים נוספים, שיעור).
דוגמאות לסגנון (ברבים — הטה אותן לגוף הפנייה שקבעת):
- הגיבו "${triggerWord}" ואשלח לכם הדרכה מוקלטת.
- כתבו "${triggerWord}" בתגובות ואשלח לכם את כל הפרטים.
- מי שרוצה את המדריך, שיכתוב "${triggerWord}" בתגובות.`}
המבנה הקבוע: \`<הגב/הגיבי/הגיבו לפי גוף הפנייה> "${triggerWord}" ו<פועל בעתיד> <לך/לכם לפי גוף הפנייה> <מה שתשלחו>\`.
חובה לשמור על המילה המדויקת "${triggerWord}" בגרשיים, ולשמור על הטון של המשתמש.`
  : `שורה אחת שמעודדת את הקורא לפעול — לשמור, לשתף, להגיב, או לפנות למשתמש.
צריכה להיות טבעית ולא מכירתית מדי.`}

## כללי כתיבה
1. כתוב בעברית, בגובה העיניים
2. השתמש בסגנון ובטון של המשתמש, לא בשפה גנרית או "שיווקית"
3. שורות קצרות, פסקאות קטנות
4. אל תשתמש בהאשטגים
5. אל תשתמש באימוג'ים אלא אם המשתמש משתמש בהם בסגנון שלו
6. אל תעשה דברים שהמשתמש ציין ב"מה אני אף פעם לא עושה"
7. **בלי מקפים בתוך משפטים.** אל תשתמש ב-em dash (—) או en dash (–), ואל תשים שני מקפים רגילים ברצף (--). אם ממש חובה לחבר רעיונות — השתמש בנקודה, פסיק, או שורה חדשה במקום. רק במקרה נדיר שאי אפשר אחרת, מקף יחיד קצר (-) ולא יותר מאחד באותו משפט.
8. **אסור לכתוב בתבנית "זה לא X, זה Y" / "זה לא X — זה Y".** התבנית הזו שחוקה ונשמעת מלאכותית. במקום זה, אמור ישירות מה זה כן ("בעצם זה Y", "מה שקורה כאן זה Y", "האמת היא Y"), או הצג רק את ה-Y בלי לפסול במפורש את ה-X.

${businessSourceInsights || ""}
## פלט
החזר את הפוסט בלבד — בלי הסברים, בלי כותרות, בלי "הנה הפוסט:".
רק הטקסט של הפוסט עצמו, מוכן להעתקה.`
}
