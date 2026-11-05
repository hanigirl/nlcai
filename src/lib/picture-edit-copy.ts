/**
 * What the AI panel says when a picture edit (lib/picture-edit) didn't
 * happen — nothing is saved, and nothing is cropped or swapped in its place.
 * Kept apart from the server code so the panel previews can use it.
 */
export const PICTURE_UNCHANGED =
  "ניסיתי לשנות את התמונה עצמה, אבל היא יצאה כמעט זהה, אז לא שמרתי כלום ולא חתכתי אותה כדי להסתיר. נסו לכתוב מה בדיוק לשנות בה."
export const PICTURE_NOT_HERS =
  "התמונה שיצאה כבר לא נראתה כמו התמונה שלכם, אז לא שמרתי אותה ולא שמתי במקומה משהו אחר. נסו שוב, ואפשר לפרט מה לשנות ומה להשאיר."
/** A picture edit on a slide that has no picture to edit. */
export const PICTURE_MISSING =
  "לא מצאתי בשקופית הזאת תמונה לשנות, אז לא שיניתי כלום. כתבו באיזו שקופית התמונה, או צרפו אותה כאן."
