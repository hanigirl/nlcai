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
}

const PRODUCT_TYPE_LABEL: Record<string, string> = {
  front: "מוצר חזית (כניסה)",
  premium: "מוצר פרימיום",
  lead_magnet: "ליד מגנט (חינמי)",
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
כתוב פוסט ליבה (Core Post) קצר לרשתות חברתיות.
הפוסט צריך להיות קליל, PUNCHY, פשוט וברור.

**חשוב מאוד: אל תכתוב בשפה גנרית.** כתוב בדיוק בסגנון שבו המשתמש מדבר וכותב — קרא בעיון את ה-Core Identity ואת הדוגמאות לסגנון שלו, והשתמש בשפה, בביטויים, ובסלנג שלו.

${identitySection}
${audienceSection}

${productSection}

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
כאן תכתוב את הערך המרכזי של הפוסט, מבוסס על מה שהמשתמש אמר:
"${userResponse}"

הנחיות לגוף:
- כתוב בפסקאות קצרות (1-2 משפטים לפסקה)
- השתמש בשורות קצרות ופאנצ'יות
- תן ערך אמיתי — טיפ, תובנה, או נקודת מבט חדשה
- דבר בגובה העיניים, לא מלמעלה
- אל תהיה ארוך מדי — פוסט סושיאל, לא מאמר

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
דוגמאות לסגנון (התאם את התוכן שאחרי "${triggerWord}" למוצר):
- הגיבו "${triggerWord}" ואשלח לכם הדרכה מוקלטת על <נושא ספציפי מתוך המוצר>.
- כתבו "${triggerWord}" בתגובות ואצרף אתכם לרשימת ה<שם הרשימה מהמוצר>.
- מי שרוצה את <הדבר הספציפי>, שיכתוב "${triggerWord}" בתגובות.`
  : `בחר משהו ערכי שמתאים לנושא הפוסט (הדרכה מוקלטת, מדריך, פרטים נוספים, שיעור).
דוגמאות לסגנון:
- הגיבו "${triggerWord}" ואשלח לכם הדרכה מוקלטת.
- כתבו "${triggerWord}" בתגובות ואשלח לכם את כל הפרטים.
- מי שרוצה את המדריך, שיכתוב "${triggerWord}" בתגובות.`}
המבנה הקבוע: \`הגיבו "${triggerWord}" ו<פועל בעתיד, ברבים> לכם <מה שתשלחו>\`.
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

${learningInsights || ""}
## פלט
החזר את הפוסט בלבד — בלי הסברים, בלי כותרות, בלי "הנה הפוסט:".
רק הטקסט של הפוסט עצמו, מוכן להעתקה.`
}
