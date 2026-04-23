import type Anthropic from "@anthropic-ai/sdk"

// Second-pass editor that looks at an already-written hook and rewrites it
// so it sounds like a real Israeli speaking — not a translation from English.
// Called AFTER the main hook-writing agent, before the hook is saved/streamed.
// Keeps the angle/message identical — only rewrites the language.
export function buildHebrewPolishPrompt(hook: string): string {
  return `קיבלת הוק בעברית שנכתב על ידי מודל AI. תפקידך: לוודא שההוק נשמע טבעי — כמו שישראלי אמיתי אומר אותו בשיחה רגילה, לא כמו תרגום מאנגלית, לא עברית "ספרותית" מוגזמת, ולא Franglish.

## ההוק הנוכחי
${hook}

## מה לבדוק
1. **מבחן "איך ישראלי באמת אומר את זה?"** — קרא את ההוק כאילו אתה שומע אותו בשיחה. אם משהו נשמע מאולץ, מתורגם, או מגושם — שכתב באופן שאנשים באמת מדברים.
2. **תרגומי רפאים מאנגלית** — אם יש מילה או ביטוי שנשמע כמו תרגום ישיר, החלף במקבילה יומיומית:
   - hack → "טריק", "שיטה", "קיצור דרך"
   - viral → "שכולם מדברים עליו", "שעף"
   - content → "תוכן", "סרטונים", "פוסטים"
   - game changer → "משנה הכל"
   - mindset → "הלך מחשבה", "גישה"
   - journey → "דרך", "תהליך"
   - level up → "להתקדם", "לקחת את X לשלב הבא"
   - actionable → "אמיתי", "שעובד"
   - proven → "שבאמת עובד", "מוכח"
   - secret/hidden → "הסוד של", "מה שלא מספרים לכם"
   - unlock / crack the code → "לפצח", "למצוא את הדרך"
3. **מותר סלנג ישראלי ושפה עממית** אם זה משרת את ההוק ומתאים לקונטקסט: "גמרנו", "מטורף", "קטן עליכם", "תקשיבו טוב", "זה מה יש", "תכלס", "חבל על הזמן", "זורמים", "זה הסוד ש...", "מה שבאמת עובד", "ברמה אחרת". השתמש בסלנג רק כשזה מוסיף אותנטיות — לא בכוח.
4. **התאם את מידת הסלנג לקונטקסט** — בנישה רצינית (רפואה, פיננסים, משפט) פחות סלנג, יותר עברית תקנית יומיומית. בנישה קלילה (פיטנס, יופי, אוכל, בידור) מותר יותר חופש וסלנג.
5. **אל תשנה את המסר, הזווית, או ההבטחה** — רק את השפה. הנושא והתבנית נשארים זהים.
6. **לשון רבים תמיד** — אתם/לכם/שלכם/תעשו/תצפו. אסור נקבה יחיד (את/לך/שלך) או זכר יחיד (אתה/לך).
7. **אורך דומה** — אל תקצר או תאריך משמעותית. הוק טיקטוקי/שורטסי נשאר.

## פלט
החזר שורה אחת בלבד — ההוק המשופר. אם ההוק הנוכחי כבר נשמע טבעי בעברית ישראלית — החזר אותו כמו שהוא. בלי הסברים, בלי גרשיים, בלי מספור, בלי מקפים בתחילת השורה.`
}

function cleanHookText(text: string): string {
  return text
    .split("\n")[0]
    .trim()
    .replace(/^\d+[\.\)]\s*/, "")
    .replace(/^["'״׳"\-*•]+/, "")
    .replace(/["'״׳"]+$/, "")
    .trim()
}

// Runs the Hebrew polish pass. If it fails (overload, network, malformed
// output), returns the original hook so the caller's flow isn't broken —
// better to ship the un-polished version than to drop the hook entirely.
export async function polishHookForHebrew(
  client: Anthropic,
  hook: string,
  model: string,
): Promise<string> {
  try {
    const res = await client.messages.create({
      model,
      max_tokens: 250,
      messages: [{ role: "user", content: buildHebrewPolishPrompt(hook) }],
    })
    const raw = res.content.find((b) => b.type === "text")?.text ?? ""
    const cleaned = cleanHookText(raw)
    // If the editor returned nothing usable, keep the original.
    if (cleaned.length <= 10) return hook
    return cleaned
  } catch (err) {
    console.error("Hook Hebrew polish failed — returning unpolished:", err)
    return hook
  }
}
