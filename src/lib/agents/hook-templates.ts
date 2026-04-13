// Structured hook templates by category — used by the homepage-hooks pipeline.
// Each category maps to angle types from the audience analysis.

export type TemplateCategory = "myth_breaking" | "common_mistakes" | "diagnosis" | "personal_story" | "empowerment" | "identification" | "agenda" | "lists" | "real_reason" | "how_to"

export interface TemplateGroup {
  category: TemplateCategory
  contentType: "awareness" | "connection" | "authority"
  label: string // Hebrew label
  goal: string // What this category achieves
  templates: string[] // Pattern strings with {slot} placeholders
}

export const TEMPLATE_LIBRARY: TemplateGroup[] = [
  {
    category: "myth_breaking",
    contentType: "awareness",
    label: "שבירת מיתוסים",
    goal: "לגרום לקהל לערער על אמונה רווחת",
    templates: [
      "X דברים שאף אחד לא סיפר לך על {בעיה / נושא}",
      "\"{עצה נפוצה}\" לא באמת {יפתור לך את הבעיה}",
      "{מיתוס} נשמע טוב, אבל זה ממש לא נכון",
      "\"{מיתוס}\"? ממש לא",
      "את לא צריכה {מה שהקהל חושב שהוא צריך} כדי להגיע ל{מטרה}",
      "הנה למה {עצה פופולרית} זה רעיון ממש גרוע",
      "{בעיה} לא {נפתרת מעצה נפוצה}",
    ],
  },
  {
    category: "common_mistakes",
    contentType: "awareness",
    label: "טעויות נפוצות",
    goal: "להצביע על טעויות שהקהל עושה ולא מודע אליהן",
    templates: [
      "X טעויות שאת עושה ש{גורמות לך לבעיה/כאב}",
      "רוצה {תוצאה}? תפסיקי {טעות שכולם עושים}",
      "אם את עושה {טעות פופולרית}, אל תצפי ל{תוצאה}",
      "אם את עושה {טעות פופולרית}, אל תופתעי כש{כאב}",
      "X טעויות ש{קהל יעד} עושים כש{מנסים להשיג מטרה}",
      "תפסיקי {לעשות פעולה} על {טעות נפוצה}",
      "{טעות נפוצה} תהרוס לך את כל הסיכויים {להגיע למטרה}",
      "{פתרון נפוץ} לא {פותר בעיה}, אלא רק מחמיר אותה",
      "יש לך {בעיה} ואת {עושה את הפעולה הנפוצה הזאת}?",
    ],
  },
  {
    category: "diagnosis",
    contentType: "awareness",
    label: "דיאגנוזה של הבעיה",
    goal: "להראות לקהל סימנים של בעיה אמיתית שהם לא הבחינו בה",
    templates: [
      "X סימנים שה{בעיה} היא בעצם {מקור הבעיה}",
      "X סימנים שאת מוכנה ל{רצון או תשוקה}",
      "X סימנים ש{זה לא מה שהיא מספרת לעצמה} אלא {מה שהיא חוששת ממנו}",
      "אם {קורה/לא קורה משהו} זה אומר {בעיה חמורה}",
      "אם את {בעיה} זה לא בגלל ש{דיאגנוזה לא נכונה}",
      "את לא {מה היא חושבת שהבעיה שלה}, את פשוט {הבעיה האמיתית}",
      "אם {זה קורה לך}, אז {זה אומר שיש לך את הבעיה הבאה}",
    ],
  },
  {
    category: "personal_story",
    contentType: "connection",
    label: "סיפור אישי (לפני/אחרי)",
    goal: "ליצור חיבור רגשי דרך סיפור אישי של היוצר",
    templates: [
      "לפני X שנים ה{מי} שלי אמר לי: \"{ציטוט}\"",
      "במשך {כמה זמן} {הייתה לי את הבעיה הזאת}",
      "הנה איך {אירוע/דבר/תוצאה} שינה לי את החיים",
      "זאת תמונה שלי מ{מה יש בתמונה}",
      "{השגתי את התוצאה}, בלי / ולא בגלל ש{מה שחושבות שצריך}",
      "לפני {כמה זמן} החלטתי {עשיתי את מה שהקהל רוצה לעשות}",
      "תוך שנה עברתי מ{מצב לפני} ל{מצב אחרי}",
      "לפני {כמה זמן} {עשיתי} ו{נהיתה לי בעייה}",
      "לפני {כמה זמן} {עשיתי} ו{יש לי חסרון/התנגדות קיימת}",
      "הלוואי ומישהו היה מספר לי את זה {כשהייתה לי הבעיה}",
      "{פעולה} יותר מ{כמה} {פעולה} {בתקופת זמן}",
      "הסיבה למה {השגתי תוצאה שלא הרבה השיגו}",
      "אני כבר {כמה זמן} {עושה משהו שהקהל רוצה לעשות}",
    ],
  },
  {
    category: "empowerment",
    contentType: "connection",
    label: "תכני העצמה",
    goal: "לתת לקהל תחושת כוח ושליטה",
    templates: [
      "אז אמרו לך ש{יש לך בעיה שאי אפשר לפתור}",
      "את לא {בעיה שהקהל חושב שיש לו}, את {בעיה קלילה יותר שקל לפתור}",
      "{זהות/מקצוע} בלי {משהו מעורר מחלוקת} היא {משהו שלילי}",
    ],
  },
  {
    category: "identification",
    contentType: "connection",
    label: "תכני הזדהות",
    goal: "לגרום לקהל להגיד \"גם אני!\"",
    templates: [
      "כשמישהו {עושה משהו} ואת מעדיפה {לעשות משהו מטורף}",
      "סליחה אם אני {משהו מעורר מחלוקת} אבל {השגתי את התוצאה}",
    ],
  },
  {
    category: "agenda",
    contentType: "connection",
    label: "תכני אג'נדה",
    goal: "להציב עמדה ברורה ולמשוך את הקהל הנכון",
    templates: [
      "רק לא עוד {משהו שהקהל לא רוצה לעשות}",
      "אם את לא {מה} אין סיכוי ש{תגיעי לתוצאה}",
      "{מי} לא יכול {להשיג תוצאה רצויה}",
      "כל {מי} צריך {מה}",
      "{מי} שלא מפחדת {לעשות משהו יוצא דופן} היא {משהו שהקהל רוצה להיות}",
      "זה יותר קל להיות {שלילי} מאשר {חיובי}",
    ],
  },
  {
    category: "lists",
    contentType: "authority",
    label: "רשימות",
    goal: "להציג ידע ממוקד ויישומי",
    templates: [
      "X {מה יש ברשימה} ש{נותנים תוצאה רצויה}",
      "X {מה יש ברשימה} ש{נותנים תוצאה לא רצויה}",
      "X ה{מה יש ברשימה} הכי טובים ב{איפה}",
      "X {מה יש ברשימה} שיעזרו לך {להשיג תוצאה} תוך {כמה זמן}",
      "{דברים שאת עושה ברגיל} ש{גורמים לך לבעיה/כאב}",
      "X {מה יש ברשימה} ש{יוצאים לך נזק}",
      "X {מה יש ברשימה} ל{פעולה} אם את רוצה {תוצאה}",
      "X {מה יש ברשימה} שאת חייבת {מתי לעשות את זה}",
    ],
  },
  {
    category: "real_reason",
    contentType: "authority",
    label: "הסיבה האמיתית לבעיה",
    goal: "לחשוף את ה-root cause שהקהל לא מודע לו",
    templates: [
      "\"אני {עושה הכל נכון} ועדיין {יש בעיה/כאב}\"",
    ],
  },
  {
    category: "how_to",
    contentType: "authority",
    label: "איך להשיג תוצאה",
    goal: "ללמד פעולה ספציפית להשגת תוצאה",
    templates: [
      "איך {להשיג תוצאה} גם/אחרי {בעיה}",
      "איך להיות יותר {תוצאה} מ-{כמה אחוז} מ{מי}",
      "איך {להשיג תוצאה} בלי {משהו לא רצוי}",
      "{כמה זמן} של ניסיון ב{תחום} ב-60 שניות",
      "אני עומדת לגלות לך בדיוק איך {להשיג תוצאה} ב{משהו ספציפי}",
      "הנה בדיוק {מה צריך לעשות/כמה צריך} כדי {להשיג תוצאה}",
      "{פתרון מוכר} לא {יביא אותך לתוצאה}, אבל {הפתרון שלי} כן",
      "תשכחי מ{פתרון ישן}. מצאתי {פתרון חדש} ל{בעיה} וזה {תועלת}",
      "מתביישת מ{בעיה}? נסי את זה {בפעם הבאה שאת עושה משהו רגיל}",
    ],
  },
]

export function getTemplatesByCategory(category: TemplateCategory): string[] {
  return TEMPLATE_LIBRARY.find((g) => g.category === category)?.templates ?? []
}

export function getCategoryLabel(category: TemplateCategory): string {
  return TEMPLATE_LIBRARY.find((g) => g.category === category)?.label ?? category
}

export function listAllCategories(): { category: TemplateCategory; label: string; contentType: string; goal: string }[] {
  return TEMPLATE_LIBRARY.map((g) => ({
    category: g.category,
    label: g.label,
    contentType: g.contentType,
    goal: g.goal,
  }))
}
