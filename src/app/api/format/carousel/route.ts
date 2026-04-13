import { createFormatRoute } from "@/lib/agents/create-format-route"
import { buildCarouselPrompt, parseCarouselResponse } from "@/lib/agents/carousel-generator"

const DUMMY_CAROUSEL = `שקופית 1
אתה עדיין מחפש כלי AI חדש כל שבוע? הנה למה זה טעות

שקופית 2
כל שבוע יוצא כלי חדש. כולם רצים לנסות. ואז עוברים לכלי הבא.

שקופית 3
במקום לקפוץ בין 10 כלים — תבחר אחד. תלמד אותו לעומק. תבנה איתו תהליך.

שקופית 4
זה מה שעשיתי עם פיגמה וקלוד. לא כי הם מושלמים — כי אני מכיר אותם מספיק טוב.

שקופית 5
העומק מנצח את הרוחב. תמיד.

שקופית 6
שמרו את זה. שלחו למי שמרגיש אבוד בין כל הכלים.`

export const POST = createFormatRoute({
  buildPrompt: buildCarouselPrompt,
  parseResponse: parseCarouselResponse,
  maxTokens: 2048,
  dummyText: DUMMY_CAROUSEL,
})
