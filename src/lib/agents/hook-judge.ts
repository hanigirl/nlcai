import type Anthropic from "@anthropic-ai/sdk"
import { JUDGE_MODEL } from "@/lib/anthropic-fallback"

// Judge step — runs AFTER the writer has drafted a hook, BEFORE the polish.
// Evaluates the hook against the quality bar Hani defined: curiosity gap,
// coherence, plural consistency, length, niche grounding, no translation ghosts,
// no punchline-delivery.
//
// Uses Sonnet 4.6 (primary model) because Hebrew grammar + logic judgement is
// where Haiku has been falling short.
//
// If the judge rejects the draft, it returns a rewritten version alongside the
// reasons. Caller decides whether to accept the rewrite or skip the hook.

export interface JudgeContext {
  /** The hook text drafted by the writer. */
  hook: string
  /** The template pattern the writer claims to have used. */
  template: string
  /** The specific topic the plan committed to (for niche-grounding check). */
  specificTopic: string
  /** The pain/desire the plan committed to. */
  targetPainOrDesire: string
  /** Any issues the programmatic pre-check already flagged — we surface them to the judge. */
  programmaticIssues: string[]
}

export interface JudgeResult {
  valid: boolean
  issues: string[]
  rewritten: string
}

const JUDGE_INSTRUCTIONS = `אתה עורך/ת ראשי/ת של הוקים לסרטונים קצרים בעברית. **גישת ברירת המחדל: פסול → שכתב.** רק הוק שעובר בבירור את כל 5 שאלות הבדיקה — אתה רשאי לאשר.

## 5 שאלות בדיקה — ענה על כל אחת בלב פתוח

### שאלה 1: האם ההוק **מבטיח** ערך במקום **למסור** אותו?
הוק טוב שומר את התשובה סגורה. אם הקורא מבין כבר מה התובנה — אין סיבה לצפות.
- ❌ "מעצבים שמפחדים מ-AI מפספסים מה שהוא לא יכול לעשות" — התזה שם.
- ✅ "3 דברים שAI עדיין לא יודע לעשות ב-2026" — מבטיח רשימה.

### שאלה 2: האם שני חצאי המשפט מתחברים לוגית?
זה הכשל הכי נפוץ. אם "אבל"/"ש-"/"כי" מחבר בין שני חצאים שאין ביניהם קשר סיבתי/לוגי ברור — פסול.
- ❌ "סליחה שאני עובדת ידנית בפיגמה עם דדליין — אבל יש סיבה שהפלואו שלכם שבור" — "סליחה שאני עובדת ידנית" לא סיבה לכך ש"הפלואו שלכם שבור". שני חצאים שלא מתחברים.
- ❌ "האמונה שהייתי חייב לוותר עליה כדי לעצב ל-AI: שמעצבים מסכימים" — אין קשר בין החצאים.
- ✅ "סליחה שאני עובדת 4 שעות ביום — אבל הגעתי לרמת הכנסה שלא הגעתי אליה ב-8 שעות" — שני חצאים מחוברים (זמן עבודה → הכנסה).

**מבחן**: נסה/י לתרגם את ההוק למשפט באנגלית. אם התרגום נשמע מעורפל או לא הגיוני — פסול.

### שאלה 3: האם פניה לקהל עקבית? (רבים בלבד, ללא ערבוב)
- פניה לקהל = רק רבים (אתם/לכם/שלכם).
- פניה של היוצר לעצמו = רק "אני".
- נושא יחיד → פועל יחיד. נושא רבים → פועל רבים.
- "AI" = זכר בעברית ("הוא", "שיודע", לא "היא"/"שיודעת").

### שאלה 4: האם ההוק מדבר על הנושא הספציפי שסופק?
לא גנרי, לא על נושא אחר. הכאב/רצון של הקהל חייב להופיע.

### שאלה 5: האם העברית ישראלית טבעית וללא שגיאות?
- לא תרגום מאנגלית, לא מטאפורות מאולצות.
- לא "משברים" במקום "שוברים", לא "זאת" במקום "זה" לפי המין הנכון.
- לא צירופים קטועים ("השחור" בלי "עבודה").
- אורך ≤ 15 מילים, משפט אחד.

## גישת ברירת מחדל: שכתב
אם אתה אפילו לא בטוח שאחת מהשאלות עוברת — **פסול ושכתב**. עדיף לשכתב הוק "בסדר" להוק מעולה מאשר לאשר הוק "בסדר" שהוא פגום.

## הפלט — JSON בלבד
\`\`\`json
{
  "q1_curiosity_gap": "pass" | "fail",
  "q2_logical_coherence": "pass" | "fail",
  "q3_grammar_consistency": "pass" | "fail",
  "q4_topic_grounding": "pass" | "fail",
  "q5_natural_hebrew": "pass" | "fail",
  "valid": true,
  "issues": [],
  "rewritten": "ההוק המשופר. חייב לעמוד בכל 5 השאלות."
}
\`\`\`

- \`valid: true\` **רק אם** כל 5 השאלות = "pass". אחרת \`valid: false\`.
- \`rewritten\` תמיד נוכח — אם פסלת, הוק משופר. אם אישרת, ההוק המקורי זהה.
- ה-rewritten **חייב** לעמוד בכל 5 השאלות. אתה העורך — לא תחזיר הוק פגום.
- התו הראשון \`{\`, האחרון \`}\`. בלי markdown, בלי הסברים מסביב.`

export async function judgeHook(
  client: Anthropic,
  ctx: JudgeContext,
  model: string = JUDGE_MODEL,
): Promise<JudgeResult> {
  const userPrompt = `${JUDGE_INSTRUCTIONS}

## הקלט הנוכחי

**ההוק:** ${ctx.hook}
**התבנית:** ${ctx.template}
**נושא ספציפי:** ${ctx.specificTopic}
**כאב/רצון:** ${ctx.targetPainOrDesire}
**בעיות שזוהו אוטומטית:** ${ctx.programmaticIssues.length > 0 ? ctx.programmaticIssues.join(", ") : "אין"}

החזר JSON.`

  try {
    const res = await client.messages.create({
      model,
      max_tokens: 1024,
      messages: [{ role: "user", content: userPrompt }],
    })
    const raw = res.content.find((b) => b.type === "text")?.text ?? ""
    const parsed = extractJsonObject(raw)
    if (!parsed) {
      console.error("Hook judge: response not parseable. First 300 chars:", raw.slice(0, 300))
      // Be permissive on parse failure — accept the original hook so the pipeline
      // doesn't collapse. Log it so we can spot systematic issues.
      return { valid: true, issues: ["judge_parse_failed"], rewritten: ctx.hook }
    }
    const result = parsed as Partial<JudgeResult> & Record<string, unknown>
    // Defensive: if ANY of the 5 explicit question fields is "fail", treat
    // the hook as invalid even if Claude set valid:true. Claude tends to be
    // too lenient with a simple boolean; the 5 questions force granular honesty.
    const QUESTION_KEYS = [
      "q1_curiosity_gap",
      "q2_logical_coherence",
      "q3_grammar_consistency",
      "q4_topic_grounding",
      "q5_natural_hebrew",
    ] as const
    const failedQuestions = QUESTION_KEYS.filter((k) => result[k] === "fail")
    const strictValid = result.valid === true && failedQuestions.length === 0

    return {
      valid: strictValid,
      issues: [
        ...(Array.isArray(result.issues) ? result.issues : []),
        ...failedQuestions.map((k) => `${k}=fail`),
      ],
      rewritten: typeof result.rewritten === "string" && result.rewritten.trim().length > 0
        ? cleanJudgeOutput(result.rewritten)
        : ctx.hook,
    }
  } catch (err) {
    console.error("Hook judge failed — accepting original:", err)
    return { valid: true, issues: ["judge_error"], rewritten: ctx.hook }
  }
}

function cleanJudgeOutput(text: string): string {
  return text
    .split("\n")[0]
    .trim()
    .replace(/^\d+[\.\)]\s*/, "")
    .replace(/^["'״׳"\-*•]+/, "")
    .replace(/["'״׳"]+$/, "")
    .trim()
}

function extractJsonObject(text: string): unknown | null {
  const trimmed = text.trim()
  if (trimmed.startsWith("{")) {
    try { return JSON.parse(trimmed) } catch { /* fall through */ }
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (fenced) {
    try { return JSON.parse(fenced[1]) } catch { /* fall through */ }
  }
  const firstBrace = trimmed.indexOf("{")
  const lastBrace = trimmed.lastIndexOf("}")
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try { return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) } catch { /* fall through */ }
  }
  return null
}

// Programmatic pre-check — deterministic, zero-cost. Run BEFORE calling the
// judge so we only pay for an LLM call when there's a real issue OR we need
// the curiosity-gap judgment (which can't be validated in code).
export function validateHookLocally(hook: string, specificTopic: string): string[] {
  const issues: string[] = []

  const words = hook.split(/\s+/).filter(Boolean)
  if (words.length > 15) issues.push(`too_long_${words.length}_words`)

  // Mixed person: plural-audience tokens vs. singular-audience tokens in the same hook.
  const pluralAudience = /\b(אתם|לכם|שלכם|תעשו|תצפו|אתכם)\b/.test(hook)
  const singularAudience = /\b(את|אתה|לך|שלך|תעשי|תעשה|תצפי|תצפה|אותך)\b/.test(hook)
  if (pluralAudience && singularAudience) issues.push("mixed_singular_plural")

  // Niche grounding — at least one content word from specific_topic should appear.
  // Stopwords in Hebrew: ignore short filler tokens.
  const STOPWORDS = new Set(["של", "את", "לא", "יש", "אם", "זה", "זו", "על", "עם", "מה", "איך", "כל", "גם"])
  const topicWords = specificTopic
    .split(/\s+/)
    .map((w) => w.trim().replace(/[,:;.!?—–-]/g, ""))
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
  if (topicWords.length > 0) {
    const hookLower = hook.toLowerCase()
    const hasGrounding = topicWords.some((w) => hookLower.includes(w.toLowerCase()))
    if (!hasGrounding) issues.push("off_topic")
  }

  return issues
}
