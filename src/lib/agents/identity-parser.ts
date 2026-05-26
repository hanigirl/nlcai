import type Anthropic from "@anthropic-ai/sdk"
type AnthropicTool = Anthropic.Tool

export const CORE_IDENTITY_PARSE_PROMPT = `את סוכנת שמפרסרת מידע על זהות יוצרת תוכן מתוך טקסט חופשי.

**שלב ראשון — סיווג מקל (ברירת המחדל היא TRUE):**
החליטי: האם המסמך כולל **כל אינפורמציה** שיכולה לעזור לזהות אותנו — מי היוצרת, מה היא עושה, איך היא נשמעת, ביטויים שהיא משתמשת בהם, מה היא נמנעת ממנו?
- כן (isWritingStyleDocument=true) — **זוהי ברירת המחדל**. הספיק שיש פסקה אחת או אפילו משפט שאפשר ללמוד ממנו על היוצרת או על האופן שבו היא מדברת. גם פרופיל אישי, סיכום עסקי, דף "אודות", או מאמר שהיוצרת כתבה — מתאימים. בקצרה: אם המסמך מספר משהו על האדם שמאחורי התוכן או על האופן שבו הוא מתבטא — true.
- לא (isWritingStyleDocument=false) — **רק** כאשר המסמך **לחלוטין לא רלוונטי**: מתכון, רשימת קניות, חשבונית, מאמר טכני לחלוטין שאין בו כל אזכור של היוצרת/הקול/הסגנון.
- כאשר יש ספק — תייגי כ-true. הטופס בהמשך יבקש מהמשתמשת להשלים שדות חסרים, אז עדיף להעביר חלקי מאשר לדחות.

**שלב שני — חילוץ מצומצם (כתבי רק מה שיש בטקסט):**
1. הטקסט לא מסודר בכותרות. אנשים כותבים בזרם חופשי — פסקאות, רשימות, סיפור אישי.
2. **חלצי רק שדות שיש להם איזכור מפורש בטקסט.** אם הטקסט אומר "הסגנון שלי חם ומכיל" — זה howISound. אם הוא נותן רשימת ביטויים — זה slangExamples. אם הוא נותן רשימת "לא אומרת" / "נמנעת מ-" — זה whatINeverDo.
3. **אל תמציאי, אל תנחשי, אל תסיקי מרמזים עקיפים.** אם הטקסט לא מזכיר את הנושא של השדה במפורש — החזירי **מחרוזת ריקה ("")**. אסור להמציא ערך מ"איך המסמך נכתב" או מהקשר רחב. הפופ-אפ למשתמשת ידאג להשלמות; את לא צריכה לכסות בעצמך.
4. תמציתי: 1-2 משפטים לשדה.
5. אם isWritingStyleDocument=false — החזירי את כל השדות כמחרוזות ריקות.

החזירי JSON בלבד, בלי markdown, בלי הסברים.

--- דוגמה למסמך סגנון תקין ---
טקסט:
"קוראים לי מאיה, מאמנת כושר 8 שנים. עובדת עם אמהות אחרי לידה שרוצות לחזור לעצמן בלי שיימינג. הסגנון שלי חם ומכיל, אני נגד דיאטות קיצוניות. מילים שחוזרות אצלי: 'חמודה', 'את יכולה', 'בקצב שלך'."

JSON:
{
  "isWritingStyleDocument": true,
  "niche": "כושר ובריאות",
  "productName": "אימוני כושר לאמהות אחרי לידה",
  "whoIAm": "מאמנת כושר עם 8 שנות ניסיון",
  "whoIServe": "אמהות אחרי לידה שרוצות לחזור לעצמן בלי שיימינג",
  "howISound": "חם, מכיל, לא שיפוטי",
  "slangExamples": "חמודה, את יכולה, בקצב שלך",
  "whatINeverDo": "לא מבטיחה תוצאות קסם, לא תומכת בדיאטות קיצוניות"
}

--- דוגמה למסמך שאינו סגנון ---
טקסט:
"מתכון לעוגת שוקולד: ביצים, קמח, שוקולד מומס. מערבבים בעדינות. אופים 40 דקות ב-180 מעלות."

JSON:
{
  "isWritingStyleDocument": false,
  "niche": "",
  "productName": "",
  "whoIAm": "",
  "whoIServe": "",
  "howISound": "",
  "slangExamples": "",
  "whatINeverDo": ""
}
--- סוף דוגמאות ---

קראי את הטקסט הבא והפעילי את הכלי \`extract_core_identity\` עם הנתונים שחילצת.`

export const AUDIENCE_IDENTITY_PARSE_PROMPT = `את סוכנת שמפרסרת מידע על קהל יעד מתוך טקסט חופשי.

**שלב ראשון — סיווג מקל (ברירת המחדל היא TRUE):**
החליטי: האם המסמך כולל **כל אינפורמציה** שיכולה לעזור לזהות את קהל היעד — מי הם, מה מטריד אותם, מה הם רוצים, מה הם ניסו, מה הם מאמינים, איך הם נראים?
- כן (isAudienceDocument=true) — **זוהי ברירת המחדל**. הספיק שיש פסקה אחת או אפילו משפט על הקהל. גם מסמכים שמדברים על "הלקוחות שלי", "האנשים שאני עוזרת להם", "הסיפור של X", פרסונה אחת בלבד, או אפילו תיאור של מוצר שמרמז על הקהל — מתאימים.
- לא (isAudienceDocument=false) — **רק** כאשר המסמך **לחלוטין לא רלוונטי**: מתכון, רשימת קניות, חשבונית, מאמר טכני שלא מאזכר אף קהל או משתמש בכלל.
- כאשר יש ספק — תייגי כ-true. הטופס בהמשך יבקש מהמשתמשת להשלים שדות חסרים, אז עדיף להעביר חלקי מאשר לדחות.

**שלב שני — חילוץ מצומצם (כתבי רק מה שיש בטקסט):**
1. הטקסט לא מסודר לפי שדות. אנשים מתארים את הקהל בפסקאות חופשיות.
2. **חלצי רק שדות שיש להם איזכור מפורש בטקסט.** "מרגישות אשמות" → emotionalPains. "פחד להיראות אנוכיות" → fears. "ניסו לקום ב-5 וזה לא החזיק" → failedSolutions. ביטוי או משפט שאת רואה בטקסט = חילוץ. אין משפט = ריק.
3. **אל תמציאי, אל תנחשי, אל תסיקי מרמזים עקיפים.** אם הטקסט לא מזכיר את הנושא של השדה במפורש — החזירי **מחרוזת ריקה ("")**. אסור להמציא דמוגרפיה, פחדים, רצונות או ציטוטים שלא כתובים בקובץ. הפופ-אפ למשתמשת ידאג להשלמות.
4. אותו ציטוט יכול להזין כמה שדות, אבל רק אם הוא באמת מתייחס אליהם.
5. תמציתי: 1-2 משפטים לשדה, בלשון הקהל עצמו כשאפשר.
6. אם isAudienceDocument=false — החזירי את כל השדות כמחרוזות ריקות.

החזירי JSON בלבד.

--- דוגמה ---
טקסט:
"הקהל שלי נשים 30-45, אמהות עובדות בהייטק במרכז. מרוויחות טוב אבל מרגישות שהן בורחות מהחיים — רצות מבוקר עד ערב, לא פוגשות חברות, הזוגיות מתנהלת על אדים. ניסו יוגה, מדיטציה, אפליקציות מיינדפולנס — שום דבר לא החזיק. פוחדות שזה כבר 'ככה זה' ושיאבדו את עצמן עד 50. מה שהן רוצות זה להרגיש שהחיים שייכים להן, לא ללו״ז."

JSON:
{
  "isAudienceDocument": true,
  "employment": "אמהות עובדות, הייטק",
  "behavioral": "רצות מבוקר עד ערב, לא פוגשות חברות, מזניחות זוגיות",
  "awarenessLevel": "מודעות לבעיה, ניסו פתרונות, עדיין מחפשות",
  "dailyPains": "לו״ז עמוס, אין זמן לעצמן, חברויות וזוגיות נפגעות",
  "emotionalPains": "בריחה מהחיים, אובדן עצמי",
  "unresolvedConsequences": "לאבד את עצמן עד גיל 50",
  "fears": "שזה 'ככה זה', שלא יוכלו לשנות",
  "failedSolutions": "יוגה, מדיטציה, אפליקציות מיינדפולנס",
  "limitingBeliefs": "",
  "myths": "",
  "dailyDesires": "רגע לנשום, זמן לעצמן",
  "emotionalDesires": "להרגיש שהחיים שייכים להן",
  "smallWins": "",
  "idealSolution": "חיים שמרגישים שלהן, לא כבולים ללו״ז",
  "bottomLine": "",
  "crossAudienceQuotes": "אני בורחת מהחיים",
  "idealSolutionWords": "שהחיים שלי שייכים לי",
  "identityStatements": "אישה שמחוברת לעצמה, לא רק אמא ועובדת"
}

--- דוגמה למסמך שאינו ניתוח קהל ---
טקסט:
"השירות שלנו: ליווי אישי לאורך 3 חודשים, פגישות שבועיות, גישה לקבוצת וואטסאפ. המחיר 4,500 ש״ח."

JSON:
{
  "isAudienceDocument": false,
  "employment": "",
  "behavioral": "",
  "awarenessLevel": "",
  "dailyPains": "",
  "emotionalPains": "",
  "unresolvedConsequences": "",
  "fears": "",
  "failedSolutions": "",
  "limitingBeliefs": "",
  "myths": "",
  "dailyDesires": "",
  "emotionalDesires": "",
  "smallWins": "",
  "idealSolution": "",
  "bottomLine": "",
  "crossAudienceQuotes": "",
  "idealSolutionWords": "",
  "identityStatements": ""
}
--- סוף דוגמאות ---

קראי את הטקסט הבא והפעילי את הכלי \`extract_audience_identity\` עם הנתונים שחילצת.`

// Tool schemas for Anthropic tool_use. Forcing tool_use is much more reliable
// than asking for JSON in text:
//   - no JSON.parse failures from Hebrew gershayim escaping issues
//   - no markdown-fence extraction
//   - the model can't omit required fields or send arrays where strings belong
// We pair these with `tool_choice: { type: "tool", name: ... }` so Claude is
// required to call the tool rather than answer in prose.
export const CORE_IDENTITY_TOOL = {
  name: "extract_core_identity",
  description:
    "החזירי את הזהות של היוצרת שחולצה מהטקסט. אם הטקסט לא מכיל מידע על שדה — החזירי מחרוזת ריקה ('') לאותו שדה. אל תמציאי תוכן.",
  input_schema: {
    type: "object",
    properties: {
      isWritingStyleDocument: {
        type: "boolean",
        description:
          "האם המסמך מכיל אינפורמציה על סגנון הכתיבה/הזהות של היוצרת. ברירת המחדל היא true — רק מסמך לחלוטין לא רלוונטי (מתכון, חשבונית וכד׳) הוא false.",
      },
      productName: { type: "string", description: "שם העסק או המוצר" },
      niche: { type: "string", description: "הנישה / תחום העיסוק" },
      whoIAm: { type: "string", description: "מי היוצרת — רקע, ניסיון, תפקיד" },
      whoIServe: { type: "string", description: "למי היוצרת פונה — קהל היעד שלה" },
      howISound: {
        type: "string",
        description: "הטון, האנרגיה, אופי הדיבור של היוצרת",
      },
      slangExamples: {
        type: "string",
        description: "ביטויים, מילים, אמרות שחוזרות אצל היוצרת",
      },
      whatINeverDo: {
        type: "string",
        description: "קווים אדומים סגנוניים — מה היוצרת לא אומרת/לא עושה",
      },
    },
    required: [
      "isWritingStyleDocument",
      "productName",
      "niche",
      "whoIAm",
      "whoIServe",
      "howISound",
      "slangExamples",
      "whatINeverDo",
    ],
  },
} satisfies AnthropicTool

export const AUDIENCE_IDENTITY_TOOL = {
  name: "extract_audience_identity",
  description:
    "החזירי את הניתוח של קהל היעד שחולץ מהטקסט. אם הטקסט לא מכיל מידע על שדה — החזירי מחרוזת ריקה (''). אל תמציאי תוכן.",
  input_schema: {
    type: "object",
    properties: {
      isAudienceDocument: {
        type: "boolean",
        description:
          "האם המסמך מכיל אינפורמציה על קהל היעד. ברירת המחדל היא true — רק מסמך לחלוטין לא רלוונטי (מתכון, מאמר טכני וכד׳) הוא false.",
      },
      employment: { type: "string", description: "תעסוקה, תפקידים, ענפים" },
      behavioral: {
        type: "string",
        description: "התנהגות יומיומית — מה הקהל עושה / לא עושה",
      },
      awarenessLevel: {
        type: "string",
        description: "רמת מודעות לבעיה ולפתרונות שניסה",
      },
      dailyPains: { type: "string", description: "כאבים יומיומיים פיזיים/מעשיים" },
      emotionalPains: { type: "string", description: "כאבים רגשיים" },
      unresolvedConsequences: {
        type: "string",
        description: "מה יקרה אם לא יפתרו את הבעיה",
      },
      fears: { type: "string", description: "פחדים, חרדות" },
      failedSolutions: { type: "string", description: "פתרונות שניסו ולא עבדו" },
      limitingBeliefs: { type: "string", description: "אמונות מגבילות" },
      myths: { type: "string", description: "מיתוסים שהקהל מאמין בהם" },
      dailyDesires: { type: "string", description: "רצונות יומיומיים מעשיים" },
      emotionalDesires: { type: "string", description: "רצונות רגשיים, איך הם רוצים להרגיש" },
      smallWins: { type: "string", description: "ניצחונות קטנים שיעידו על התקדמות" },
      idealSolution: { type: "string", description: "הפתרון האידיאלי בעיני הקהל" },
      bottomLine: { type: "string", description: "מה הקהל באמת רוצה במהותו" },
      crossAudienceQuotes: {
        type: "string",
        description: "ציטוטים/ביטויים בשפת הקהל שחוזרים",
      },
      idealSolutionWords: {
        type: "string",
        description: "המילים שבהן הקהל מתאר את הפתרון שלהם",
      },
      identityStatements: {
        type: "string",
        description: "משפטי זהות — איך הקהל רוצה לראות את עצמו",
      },
    },
    required: [
      "isAudienceDocument",
      "employment",
      "behavioral",
      "awarenessLevel",
      "dailyPains",
      "emotionalPains",
      "unresolvedConsequences",
      "fears",
      "failedSolutions",
      "limitingBeliefs",
      "myths",
      "dailyDesires",
      "emotionalDesires",
      "smallWins",
      "idealSolution",
      "bottomLine",
      "crossAudienceQuotes",
      "idealSolutionWords",
      "identityStatements",
    ],
  },
} satisfies AnthropicTool

// Focused 5-field tool for the audience critical-fields retry. We define a
// dedicated tool so the response carries exactly those fields and nothing
// else — keeps the retry output tight and the merge logic trivial.
export const AUDIENCE_CRITICAL_RETRY_TOOL = {
  name: "fill_audience_critical_fields",
  description:
    "מלאי את 5 השדות הקריטיים על בסיס המסמך. אם באמת אין תוכן עבור שדה — החזירי מחרוזת ריקה.",
  input_schema: {
    type: "object",
    properties: {
      dailyPains: { type: "string" },
      emotionalPains: { type: "string" },
      fears: { type: "string" },
      dailyDesires: { type: "string" },
      emotionalDesires: { type: "string" },
    },
    required: [
      "dailyPains",
      "emotionalPains",
      "fears",
      "dailyDesires",
      "emotionalDesires",
    ],
  },
} satisfies AnthropicTool
