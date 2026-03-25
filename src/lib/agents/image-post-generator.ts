import type { FormatAgentInput } from "./types"
import { buildIdentitySection, buildAudienceSection } from "./prompt-helpers"

export function buildImagePostPrompt({
  corePostText,
  coreIdentity,
  audienceIdentity,
}: FormatAgentInput): string {
  return `אתה תת-סוכן של סוכן פוסט הליבה. התפקיד שלך הוא לקחת פוסט ליבה קיים ולשכפל אותו לפורמט Image Post — טקסט קצר שיופיע על גבי תמונה (פוסט תמונה לאינסטגרם/לינקדאין).

## הפוסט המקורי (פוסט ליבה)
${corePostText}

${buildIdentitySection(coreIdentity)}
${buildAudienceSection(audienceIdentity)}

## המשימה שלך
קח את פוסט הליבה וקצר אותו לטקסט שיופיע על גבי תמונה — קצר, פאנצ'י, קריא במבט אחד.

## כללי Image Post — Best Practices
1. **כותרת:** שורה אחת חזקה — ההוק מהפוסט המקורי בגרסה מקוצרת ופאנצ'ית
2. **תת-כותרת (אופציונלי):** שורה נוספת שמרחיבה או מחדדת את הכותרת
3. **טקסט תחתון (אופציונלי):** CTA קצר או משפט סיום חזק
4. מקסימום 1-3 שורות טקסט בסה"כ — זה חייב להיות קריא על תמונה
5. כל שורה צריכה לעמוד בפני עצמה
6. שפה ישירה ופאנצ'ית — בלי הסברים ארוכים
7. שמור על הסגנון והטון של המשתמש — לא שפה גנרית
8. הרעיון המרכזי של הפוסט חייב לעבור במשפט אחד

## פורמט הפלט
החזר את הטקסט בפורמט הזה בדיוק, בלי שום דבר נוסף:

[כותרת]
טקסט הכותרת

[תת-כותרת]
טקסט התת-כותרת

[טקסט תחתון]
טקסט תחתון`
}
