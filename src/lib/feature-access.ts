/**
 * "התמונה תכנס ביצירה הראשונה אם שמתי אותה כרפרנס" (Hani, 2026-11-05): an
 * image attached in the AI panel's first question is put INTO the first
 * generation as it is (lib/media-brief withPlacedImages, lib/placed-check).
 * Hani only while she tries it. Everyone else gets exactly what they had:
 * every attached image is a look reference — no strict mode, no check.
 * Enforced on the server (the four generate routes), not only in the panel.
 */
export const REF_PLACE_EMAILS = ["hanigirl@gmail.com", "nataliya@nataliyarey.com"]

export function canPlaceRefs(email: string | null | undefined): boolean {
  return !!email && REF_PLACE_EMAILS.includes(email.toLowerCase())
}

/**
 * The generate routes' split: her pictures to place, and look references.
 * Off the gate, pictures sent to place are looks like the rest — as before.
 */
export function gatePlacement(
  email: string | null | undefined,
  place: string[],
  looks: string[],
): { place: string[]; looks: string[] } {
  return canPlaceRefs(email) ? { place, looks } : { place: [], looks: [...place, ...looks] }
}

/**
 * "שתשתלב בעיצוב שהוא עשה" (Hani, 2026-11-05): in a b-roll AI edit, a picture
 * she attaches is blended into the existing background (api/b-roll/edit),
 * not pasted as is. Hani only while she tries it; everyone else keeps her
 * photo over a blurred fill. Enforced on the server.
 */
export const BROLL_BLEND_EMAILS = ["hanigirl@gmail.com", "nataliya@nataliyarey.com"]

export function canBlendBRoll(email: string | null | undefined): boolean {
  return !!email && BROLL_BLEND_EMAILS.includes(email.toLowerCase())
}

/**
 * "כשאני מבקשת שמשהו ישתלב הוא כבר יעשה את זה כמו שצריך" (Hani, 2026-11-05):
 * when a carousel AI edit asks to change a PICTURE on a slide itself — remove
 * the text from it, clean it, extend it, blend it in, recolour it to fit —
 * the picture goes through the image model (lib/picture-edit) and the result
 * is placed back on the slide, instead of a CSS crop that hides the problem.
 * Hani only while she tries it; enforced on the server (api/media/ai-edit,
 * api/carousel/generate-ai). Everyone else keeps main's behaviour.
 */
export const PICTURE_EDIT_EMAILS = ["hanigirl@gmail.com", "nataliya@nataliyarey.com"]

export function canEditPictures(email: string | null | undefined): boolean {
  return !!email && PICTURE_EDIT_EMAILS.includes(email.toLowerCase())
}

/**
 * "תעשה לי כזה" (Hani, 2026-11-07): a carousel built on another carousel's
 * structure (link or screenshots), in her brand or exactly like it. Hani +
 * Nataliya while they try it; enforced on the server (api/carousel/generate-ai,
 * api/carousel/reference-slides) and in the panel.
 */
export const COPY_STRUCTURE_EMAILS = ["hanigirl@gmail.com", "nataliya@nataliyarey.com"]

export function canCopyStructure(email: string | null | undefined): boolean {
  return !!email && COPY_STRUCTURE_EMAILS.includes(email.toLowerCase())
}

/**
 * Talking head AI edit (Notion: "עריכת דיבור למצלמה, עריכה עם כתוביות",
 * Hani, 2026-11-07): ✨ on her talking-head video, captions / supporting
 * elements / her own prompt, a plan to approve before the paid edit, a cover
 * made on request (not automatically) with a reminder before approval.
 * Everyone else keeps today's flow exactly — the automatic cover included.
 */
export const TALKING_HEAD_AI_EMAILS = ["hanigirl@gmail.com", "nataliya@nataliyarey.com"]

export function canTalkingHeadAi(email: string | null | undefined): boolean {
  return !!email && TALKING_HEAD_AI_EMAILS.includes(email.toLowerCase())
}

/**
 * Her own media + the script's text on it, every format and every way in
 * (Hani, 2026-11-09 — the launch was held back for this). The fixed paths run
 * for her only; everyone else keeps today's paths until she opens it.
 */
export const OWN_MEDIA_TEXT_EMAILS = ["hanigirl@gmail.com", "nataliya@nataliyarey.com"]

export function canOwnMediaText(email: string | null | undefined): boolean {
  return !!email && OWN_MEDIA_TEXT_EMAILS.includes(email.toLowerCase())
}

/**
 * IRON RULE 1 (Hani, 2026-11-09): her picture is ALWAYS the background, the
 * script's text in front of it — never a small inset inside an AI design.
 * The generate routes that would place it inside a design refuse instead
 * (fixed path, gated); her picture + text is "שים טקסט מעל" in the chat.
 */
export const PICTURE_IS_BACKGROUND = {
  error: "picture_is_background",
  message: 'התמונה שלכם תמיד תהיה הרקע, והטקסט מהסקריפט מעליה. צרפו אותה ולחצו "שים טקסט מעל".',
}

export function refusesPlacingIntoDesign(email: string | null | undefined, place: string[]): boolean {
  return canOwnMediaText(email) && place.length > 0
}

/**
 * The AI edit chat is off for these accounts (Hani, 2026-11-09: "the chat is
 * deleted for me until we rebuild it smart enough" — lib/edit-agent). No
 * "עריכה עם AI" on media, no chat panel, and no "חדש לגמרי" tile (it only
 * works by talking first); every other style generates straight away.
 */
export const NO_AI_CHAT_EMAILS = ["hanigirl@gmail.com", "nataliya@nataliyarey.com"]
export function canUseAiChat(email: string | null | undefined): boolean {
  return !(email && NO_AI_CHAT_EMAILS.includes(email.toLowerCase()))
}

/**
 * The AI edit chat as an agent (Hani, 2026-11-10 — lib/edit-agent): it sees
 * the media and the whole conversation, works in steps, looks at its result,
 * asks when unsure and explains what happened; it runs on the server. B-roll
 * first. Never on her own media from Drive / her computer (iron rule).
 */
export const EDIT_AGENT_EMAILS = ["hanigirl@gmail.com", "nataliya@nataliyarey.com"]
export function canUseEditAgent(email: string | null | undefined): boolean {
  return !!email && EDIT_AGENT_EMAILS.includes(email.toLowerCase())
}

/**
 * B-roll text appears at once — no animation on the words; only elements may
 * move (Hani for Nataliya, 2026-11-10).
 */
export const STATIC_BROLL_TEXT_EMAILS = ["nataliya@nataliyarey.com"]
export function staticBRollText(email: string | null | undefined): boolean {
  return !!email && STATIC_BROLL_TEXT_EMAILS.includes(email.toLowerCase())
}

/**
 * EXPERIMENT (Hani, 2026-11-10): her visual-language b-roll builds one file
 * from her Drive b-roll folder into the composition (lib/broll-animation/library-media).
 */
export const DRIVE_IN_BROLL_EMAILS = ["hanigirl@gmail.com", "nataliya@nataliyarey.com"]
export function driveInBRoll(email: string | null | undefined): boolean {
  return !!email && DRIVE_IN_BROLL_EMAILS.includes(email.toLowerCase())
}

/**
 * "עריכה עם AI" on her OWN b-roll (Drive / upload), the caption only — its
 * position, colours and size (Hani, 2026-11-10: "רק במה שאמרתי"). Never her
 * pixels, never the words (the script).
 */
export const OWN_BROLL_CAPTION_EDIT_EMAILS = ["hanigirl@gmail.com", "nataliya@nataliyarey.com"]
export function canEditOwnBRollCaption(email: string | null | undefined): boolean {
  return !!email && OWN_BROLL_CAPTION_EDIT_EMAILS.includes(email.toLowerCase())
}

/**
 * Her words are on screen from the first frame — no fade-in, no delayed
 * entrance — but they may still move a little once there (Hani, 2026-11-10:
 * "שתהיה אנימציה מסוימת ... אבל שלא יכנס בפייד או באיחור").
 */
export const TEXT_AT_ONCE_EMAILS = ["hanigirl@gmail.com"]
export function textAtOnceBRoll(email: string | null | undefined): boolean {
  return !!email && TEXT_AT_ONCE_EMAILS.includes(email.toLowerCase())
}

/**
 * "דוגמאות לשימוש" are part of the visual language (Hani, 2026-11-11): one
 * more accordion on שפה ויזואלית, after the graphic elements, instead of a
 * page of their own. Every example is checked against her language — right
 * after upload when that takes seconds, and in every analysis — and one that
 * doesn't fit gets a red X, is greyed out and never reaches a generator. Her
 * colours, fonts and elements decide; one stray example no longer turns the
 * whole language "inconsistent". Hani + Nataliya while they try it.
 */
export const EXAMPLES_IN_LANGUAGE_EMAILS = ["hanigirl@gmail.com", "nataliya@nataliyarey.com"]
export function examplesInLanguage(email: string | null | undefined): boolean {
  return !!email && EXAMPLES_IN_LANGUAGE_EMAILS.includes(email.toLowerCase())
}
