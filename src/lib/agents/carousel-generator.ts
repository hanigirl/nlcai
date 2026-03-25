import type { FormatAgentInput } from "./types"
import { buildIdentitySection, buildAudienceSection } from "./prompt-helpers"

export function buildCarouselPrompt({
  corePostText,
  coreIdentity,
  audienceIdentity,
}: FormatAgentInput): string {
  return `אתה תת-סוכן של סוכן פוסט הליבה. התפקיד שלך הוא לקחת פוסט ליבה קיים ולשכפל אותו לפורמט קרוסלה (Carousel) לאינסטגרם/לינקדאין.

## הפוסט המקורי (פוסט ליבה)
${corePostText}

${buildIdentitySection(coreIdentity)}
${buildAudienceSection(audienceIdentity)}

## המשימה שלך
קח את פוסט הליבה ופרק אותו לסליידים של קרוסלה.

## כללי קרוסלה — Best Practices
1. **סלייד 1 (כריכה):** הוק חזק + ויזואלי — זה מה שגורם לאנשים לעצור ולגלול. השתמש בשורת ההוק מהפוסט המקורי
2. **סליידים 2-6 (תוכן):** כל סלייד = רעיון אחד בלבד. קצר וברור
3. **סלייד אחרון (סיום):** הנעה לפעולה + סיכום קצר
4. מומלץ 5-8 סליידים בסה"כ. לא פחות מ-4, לא יותר מ-10
5. כל סלייד מורכב מ:
   - **כותרת** — משפט אחד קצר ופאנצ'י (מודגש)
   - **טקסט** (אופציונלי) — 1-3 משפטים שמרחיבים על הכותרת
6. הטקסט צריך לעמוד בפני עצמו — מי שרואה סלייד בודד צריך להבין אותו
7. שמור על הסגנון והטון של המשתמש — לא שפה גנרית
8. קצר ותמצת — קרוסלה היא לא מאמר. אם צריך לקצר מהפוסט המקורי — קצר

## פורמט הפלט
החזר JSON בלבד, בלי שום טקסט נוסף. בדיוק בפורמט הזה:
[
  {
    "slide": 1,
    "type": "cover",
    "title": "טקסט הכותרת של הכריכה",
    "body": ""
  },
  {
    "slide": 2,
    "type": "content",
    "title": "כותרת הסלייד",
    "body": "טקסט הגוף של הסלייד"
  },
  {
    "slide": 3,
    "type": "cta",
    "title": "כותרת סלייד הסיום",
    "body": "טקסט הנעה לפעולה"
  }
]

type יכול להיות: "cover" (כריכה), "content" (תוכן), "cta" (הנעה לפעולה).
title הוא חובה בכל סלייד. body אופציונלי (יכול להיות ריק).`
}

export interface CarouselSlide {
  slide: number
  type: "cover" | "content" | "cta"
  title: string
  body: string
}

export function parseCarouselResponse(text: string): CarouselSlide[] {
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return []
    return JSON.parse(jsonMatch[0])
  } catch {
    return []
  }
}

export function carouselToText(slides: CarouselSlide[]): string {
  return slides
    .map((s) => {
      const typeLabel =
        s.type === "cover" ? "כריכה" : s.type === "cta" ? "סיום" : `סלייד ${s.slide}`
      const parts = [`[${typeLabel}]`, `כותרת: ${s.title}`]
      if (s.body) parts.push(s.body)
      return parts.join("\n")
    })
    .join("\n\n")
}
