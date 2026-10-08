/**
 * What went wrong with a carousel, in words she can act on.
 *
 * The routes already return useful reasons (OpenAI not connected, no visual
 * language yet, too many slides, the OpenAI error itself) — but always with
 * an error status, and the panel threw on any non-2xx before reading the
 * body, so every failure became "שגיאה ביצירת הקרוסלה" (Hani, 2026-10-08:
 * "users get an error and it doesn't say what"). This reads the body
 * whatever the status and translates the common OpenAI failures.
 */

export type CarouselErrorInfo = {
  message: string
  action?: { label: string; href: string }
}

const OPENAI_BILLING = "https://platform.openai.com/settings/organization/billing/overview"
const OPENAI_ORG = "https://platform.openai.com/settings/organization/general"

export function carouselErrorInfo(status: number, body: unknown): CarouselErrorInfo {
  const data = (body && typeof body === "object" ? body : {}) as { error?: unknown; message?: unknown }
  const code = typeof data.error === "string" ? data.error : ""
  // The route's own Hebrew sentence wins — it was written for this case.
  if (typeof data.message === "string" && data.message.trim()) {
    return {
      message: data.message,
      action: code === "openai_not_connected" ? { label: "לחיבור OpenAI", href: "/settings?tab=connections&sub=openai" } : undefined,
    }
  }

  const raw = code.replace(/^(יצירת קרוסלת ה-AI נכשלה|Failed to generate carousel):\s*/, "")

  // No JSON at all: the platform cut the request off (an AI carousel can run
  // for minutes) or the server fell over before answering.
  if (!code) {
    if (status === 504 || status === 0) {
      return { message: "יצירת הקרוסלה לקחה יותר מדי זמן ונעצרה. נסו שוב, או קצרו את הטקסט לפחות שקופיות." }
    }
    if (status === 401) return { message: "פג תוקף ההתחברות. רעננו את העמוד ונסו שוב." }
    return { message: `יצירת הקרוסלה נכשלה (שגיאה ${status || "רשת"}). נסו שוב בעוד רגע.` }
  }

  if (/תקרת החיוב|קרדיט|billing|quota|insufficient/i.test(raw)) {
    return {
      message: "נגמר הקרדיט בחשבון ה-OpenAI שלכם (או שהגעתם לתקרת החיוב), ולכן אי אפשר לצייר את השקופיות.",
      action: { label: "הטענת קרדיט", href: OPENAI_BILLING },
    }
  }
  if (/organization must be verified|verify your organization|verification/i.test(raw)) {
    return {
      message: "OpenAI דורשת לאמת את הארגון בחשבון שלכם לפני שאפשר לייצר תמונות. זה נעשה פעם אחת בהגדרות של OpenAI.",
      action: { label: "לאימות הארגון", href: OPENAI_ORG },
    }
  }
  if (/incorrect api key|invalid api key|invalid_api_key|401/i.test(raw)) {
    return {
      message: "מפתח ה-OpenAI שמחובר לא תקף. צרו מפתח חדש וחברו אותו מחדש.",
      action: { label: "לחיבור OpenAI", href: "/settings?tab=connections&sub=openai" },
    }
  }
  if (/safety|content policy|moderation|rejected.*(system|policy)/i.test(raw)) {
    return { message: "OpenAI סירבה לצייר אחת השקופיות בגלל מדיניות התוכן שלה. נסו לנסח את הטקסט אחרת." }
  }
  if (/rate limit|too many requests|429/i.test(raw)) {
    return { message: "OpenAI מגבילה כרגע את קצב הבקשות בחשבון שלכם. נסו שוב בעוד דקה." }
  }
  if (/overloaded|503|502|timeout|timed out/i.test(raw)) {
    return { message: "השרתים של OpenAI עמוסים כרגע. נסו שוב בעוד כמה דקות." }
  }
  if (status === 401 || code === "Unauthorized") {
    return { message: "פג תוקף ההתחברות. רעננו את העמוד ונסו שוב." }
  }
  if (/not found|is not an AI template|is AI-based/i.test(raw)) {
    return { message: "הטמפלט שנבחר לא זמין. בחרו טמפלט אחר ונסו שוב." }
  }
  // Unknown — still say what it was, so a screenshot tells us something.
  return { message: `יצירת הקרוסלה נכשלה: ${raw || code}` }
}
