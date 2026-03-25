import { createFormatRoute } from "@/lib/agents/create-format-route"
import { buildStoryPrompt } from "@/lib/agents/story-generator"

const DUMMY_STORY = `[מסך 1]
אתה עדיין מחפש כלי AI חדש כל שבוע?
עצור.

[מסך 2]
הבעיה היא לא הכלים.
הבעיה היא שאתה קופץ בין כולם בלי ללמוד אף אחד לעומק.

[מסך 3]
תבחר כלי אחד.
תלמד אותו לעומק.
תבנה איתו תהליך.
העומק מנצח את הרוחב. תמיד.

[מסך 4]
שלח את זה למישהו שצריך לשמוע את זה 👇`

export const POST = createFormatRoute({
  buildPrompt: buildStoryPrompt,
  maxTokens: 1024,
  dummyText: DUMMY_STORY,
})
