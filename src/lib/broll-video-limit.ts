/**
 * The biggest video from her computer for a b-roll (Hani, 2026-11-10:
 * "תגביל ... למשהו נורמלי"): 50MB — the storage upload ceiling, and a
 * phone clip of a few seconds to ~half a minute fits. Checked in the browser
 * before anything is uploaded.
 */
export const MAX_BROLL_VIDEO_MB = 50
export const MAX_BROLL_VIDEO_BYTES = MAX_BROLL_VIDEO_MB * 1024 * 1024
export const BROLL_VIDEO_TOO_BIG = `הסרטון גדול מ־${MAX_BROLL_VIDEO_MB}MB. בחרו סרטון קצר יותר, או קצרו אותו בטלפון ונסו שוב.`
