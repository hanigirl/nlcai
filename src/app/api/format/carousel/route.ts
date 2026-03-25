import { createFormatRoute } from "@/lib/agents/create-format-route"
import { buildCarouselPrompt, parseCarouselResponse, carouselToText } from "@/lib/agents/carousel-generator"

const DUMMY_CAROUSEL = `[כריכה]
כותרת: אתה עדיין מחפש כלי AI חדש כל שבוע? הנה למה זה טעות

[סלייד 2]
כותרת: הבעיה האמיתית
כל שבוע יוצא כלי חדש. כולם רצים לנסות. ואז עוברים לכלי הבא.

[סלייד 3]
כותרת: מה שבאמת עובד
במקום לקפוץ בין 10 כלים — תבחר אחד. תלמד אותו לעומק. תבנה איתו תהליך.

[סלייד 4]
כותרת: הדוגמה שלי
זה מה שעשיתי עם פיגמה וקלוד. לא כי הם מושלמים — כי אני מכיר אותם מספיק טוב.

[סלייד 5]
כותרת: הכלל הפשוט
העומק מנצח את הרוחב. תמיד.

[סיום]
כותרת: שמרו את זה
למי שמרגיש אבוד בין כל הכלים — שלחו לו את הקרוסלה הזו`

export const POST = createFormatRoute({
  buildPrompt: buildCarouselPrompt,
  parseResponse: (text) => carouselToText(parseCarouselResponse(text)),
  maxTokens: 2048,
  dummyText: DUMMY_CAROUSEL,
})
