import { createFormatRoute } from "@/lib/agents/create-format-route"
import { buildImagePostPrompt } from "@/lib/agents/image-post-generator"

const DUMMY_IMAGE_POST = `[כותרת]
העומק מנצח את הרוחב. תמיד.

[תת-כותרת]
תפסיקו לקפוץ בין כלים — תבחרו אחד ותלמדו אותו לעומק

[טקסט תחתון]
שמרו את זה לפעם הבאה שתפתו לנסות כלי חדש 👇`

export const POST = createFormatRoute({
  buildPrompt: buildImagePostPrompt,
  maxTokens: 512,
  dummyText: DUMMY_IMAGE_POST,
})
