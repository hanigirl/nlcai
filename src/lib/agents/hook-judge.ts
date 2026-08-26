import type Anthropic from "@anthropic-ai/sdk"
import { JUDGE_MODEL } from "@/lib/anthropic-fallback"
import { hookSimilarity } from "@/lib/agents/hook-similarity"

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
  /**
   * Required addressing gender for the hook (from the user's draft or the
   * audience). null/undefined = no requirement beyond internal consistency.
   */
  addressGender?: "masculine" | "feminine" | "plural" | null
}

const ADDRESS_GENDER_LABEL: Record<string, string> = {
  masculine: "זכר יחיד (אתה/לך/תעשה)",
  feminine: "נקבה יחידה (את/לך/תעשי)",
  plural: "לשון רבים (אתם/לכם/תעשו)",
}

/** What one judge call actually cost, so the caller can prove the cache works. */
export interface JudgeUsage {
  input: number
  cacheRead: number
  cacheWrite: number
}

export interface JudgeResult {
  valid: boolean
  issues: string[]
  rewritten: string
  /** Absent when the call never reached the API (parse guard, thrown error). */
  usage?: JudgeUsage
}

/**
 * The static half of the judge: a ~3k-token Hebrew rubric that is byte-for-byte
 * identical across every hook in a batch. Sent as the cached `system` block so
 * the ten judge calls in one run pay for it once instead of ten times. The only
 * thing that varies is addressGender, which is fixed for a whole run — so the
 * prefix really is stable, which is the entire requirement for a cache hit.
 *
 * Nothing hook-specific may move in here. One interpolated hook and every call
 * has a different prefix, the cache never hits, and the cost silently returns
 * to what it was with no error to notice.
 */
export const judgeInstructions = (
  addressGender?: "masculine" | "feminine" | "plural" | null,
) => `אתה עורך/ת ראשי/ת של הוקים לסרטונים קצרים בעברית. **גישת ברירת המחדל: פסול → שכתב.** רק הוק שעובר בבירור את כל 5 שאלות הבדיקה — אתה רשאי לאשר.

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

### שאלה 3: האם פניה לקהל עקבית ובגוף הנכון?
${addressGender
  ? `- פניה לקהל = אך ורק ב${ADDRESS_GENDER_LABEL[addressGender]}. הוק שפונה בגוף אחר — פסול, וה-rewritten חייב להיות באותו גוף נדרש.`
  : `- פניה לקהל בגוף אחד עקבי — אסור לערבב יחיד ורבים (או זכר ונקבה) באותו הוק. אל תמיר יחיד לרבים אם ההוק עקבי — הגוף נקבע בשלב הכתיבה.`}
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
  // A repeat is not one of the five questions and the judge will happily pass
  // a well-built hook that says what last week's hook said. Handing it the
  // duplicate as a plain "issue" was not enough — it needs the verdict spelled
  // out, and it needs the duplicated text so the rewrite moves away from that
  // angle instead of landing on it again.
  const repeatIssue = ctx.programmaticIssues.find((i) => i.startsWith("repeats_existing_hook"))
  const repeatRule = repeatIssue
    ? `

## ⛔ פסילה אוטומטית — חזרה
${repeatIssue}

ההוק הזה חוזר על זווית שכבר הוצגה למשתמש. **לא משנה כמה הוא טוב** — סמן \`valid: false\`, והוסף \`"repeat"\` ל-issues. ה-\`rewritten\` חייב לתקוף את הנושא **מזווית אחרת לגמרי** — כאב אחר, הבטחה אחרת, מבנה אחר. ניסוח מחדש של אותו רעיון נחשב כישלון.`
    : ""

  const userPrompt = `## הקלט הנוכחי

**ההוק:** ${ctx.hook}
**התבנית:** ${ctx.template}
**נושא ספציפי:** ${ctx.specificTopic}
**כאב/רצון:** ${ctx.targetPainOrDesire}
**בעיות שזוהו אוטומטית:** ${ctx.programmaticIssues.length > 0 ? ctx.programmaticIssues.join(", ") : "אין"}${repeatRule}

החזר JSON.`

  try {
    const res = await client.messages.create({
      model,
      max_tokens: 1024,
      system: [
        {
          type: "text",
          text: judgeInstructions(ctx.addressGender),
          // 1h, not the 5-minute default: a user who regenerates twenty
          // minutes later still hits it, and that regenerate-again loop is
          // exactly the behaviour we are paying for.
          cache_control: { type: "ephemeral", ttl: "1h" },
        },
      ],
      messages: [{ role: "user", content: userPrompt }],
    })
    const usage: JudgeUsage = {
      input: res.usage.input_tokens,
      cacheRead: res.usage.cache_read_input_tokens ?? 0,
      cacheWrite: res.usage.cache_creation_input_tokens ?? 0,
    }
    const raw = res.content.find((b) => b.type === "text")?.text ?? ""
    const parsed = extractJsonObject(raw)
    if (!parsed) {
      console.error("Hook judge: response not parseable. First 300 chars:", raw.slice(0, 300))
      // Be permissive on parse failure — accept the original hook so the pipeline
      // doesn't collapse. Log it so we can spot systematic issues.
      return { valid: true, issues: ["judge_parse_failed"], rewritten: ctx.hook, usage }
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

    const finalText = typeof result.rewritten === "string" && result.rewritten.trim().length > 0
      ? cleanJudgeOutput(result.rewritten)
      : ctx.hook

    // Did the rewrite actually move? Flipping a flagged repeat to valid:false
    // and handing back a reworded copy of the same angle is the bug wearing a
    // different coat, and it would look like a fix in the logs. Say plainly
    // when the judge did not escape the angle it was told to escape.
    if (repeatIssue && hookSimilarity(finalText, ctx.hook) > 0.8) {
      console.warn(
        `Hook judge: told to escape a repeat but returned the same angle — "${finalText.slice(0, 60)}"`,
      )
    }

    return {
      valid: strictValid,
      issues: [
        ...(Array.isArray(result.issues) ? result.issues : []),
        ...failedQuestions.map((k) => `${k}=fail`),
      ],
      rewritten: finalText,
      usage,
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
