import type Anthropic from "@anthropic-ai/sdk"

// Second-pass editor that looks at an already-written hook and rewrites it
// so it sounds like a real Israeli speaking — not a translation from English.
// Called AFTER the main hook-writing agent, before the hook is saved/streamed.
// Keeps the angle/message identical — only rewrites the language.
export function buildHebrewPolishPrompt(hook: string): string {
  return `קיבלת הוק שעבר כבר judge — רוב הבעיות המבניות כבר תוקנו. תפקידך כעורך/ת אחרון/ה: להחליק את השפה לעברית ישראלית טבעית ולנקות שאריות טעויות כתיב.

## ההוק
${hook}

## מה לתקן (רק אם צריך)
1. **שגיאות כתיב וניסוחים לא תקינים** — כולל "משברים" במקום "שוברים", "זאת" vs "זה" לפי מין, התאמות לא נכונות.
2. **תרגומי רפאים מאנגלית** — החלף במקבילה יומיומית:
   - hack→"טריק/שיטה", content→"תוכן", mindset→"הלך מחשבה", game changer→"משנה הכל", level up→"להתקדם".
3. **צירופים קטועים** — "השחור" לבד → "עבודה שחורה". "על הקו" לבד → הוסף הקשר.
4. **AI = זכר** (הוא/שיודע/שעושה). אם זיהית "היא"/"שיודעת" על AI — תקן/י.
5. **לשון רבים לקהל תמיד** (אתם/לכם). אם יש יחיד (את/אתה/לך/שלך) על הקהל — המר/י לרבים.

**אל תשנה/י את המסר או הזווית** — רק את השפה.

## פלט
שורה אחת — ההוק אחרי ההחלקה. אם ההוק כבר נקי — החזר/י אותו כמו שהוא. בלי הסברים, בלי גרשיים, בלי מקפים.`
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
