/**
 * Minimal Gemini client for hook generation.
 *
 * Talks to the Interactions API directly over fetch rather than pulling in a
 * fifth SDK. Google removed the old `models/{model}:generateContent` endpoint
 * on 2026-06-08 — `/v1beta/interactions` with the `steps` response schema is
 * the only shape that exists now.
 *
 * Deliberately small: one text-in / text-out call, no streaming, no tools, no
 * conversation state (`store: false` keeps nothing on Google's side).
 */

// Pro for hooks: the "punch stays out of the hook" rule is a reasoning check,
// and that's exactly what the thinking budget buys.
//
// Flash is not just an overload fallback — it's the only model a free Gemini
// key can reach. Google lists gemini-3.1-pro-preview as "Free tier: not
// available", so a user on a free key gets rejected on EVERY Pro call. That's
// why generateWithGeminiFallback retries on any failure, not just 5xx.
export const GEMINI_PRIMARY_MODEL = "gemini-3.1-pro-preview"
export const GEMINI_FALLBACK_MODEL = "gemini-3.6-flash"
/** The model hooks are actually written with — see generateWithGeminiFallback. */
export const GEMINI_WRITER_MODEL = GEMINI_FALLBACK_MODEL

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions"

// Pinned explicitly. The header is ignored as of 2026-06-08 (the legacy
// `outputs` schema is gone), but naming the revision we parse against means a
// future schema flip fails loudly here instead of silently returning "".
const API_REVISION = "2026-05-20"

export type GeminiErrorCode =
  | "invalid_key"
  | "quota"
  | "overloaded"
  | "empty"
  | "unknown"

export class GeminiError extends Error {
  code: GeminiErrorCode
  status?: number
  /** On a 429: how long Google says to wait before retrying, if it said. */
  retryAfterMs?: number
  /** On a 429: the DAILY cap was hit — waiting a minute won't help. */
  daily?: boolean
  constructor(code: GeminiErrorCode, message: string, status?: number) {
    super(message)
    this.name = "GeminiError"
    this.code = code
    this.status = status
  }
}

/**
 * Read Google's 429 body. Two shapes exist:
 *   - google.rpc style: `RetryInfo.retryDelay` ("37s") + a `...PerDay...` quota id
 *   - the Interactions API's plain message, verbatim from production
 *     (2026-10-08): "Rate limit exceeded for model gemini-3.6-flash (limit: 20
 *     requests per day on Free Tier). Please retry in 15h26m48s ..."
 * Only the first shape was handled, so a daily cap read as per-minute: the
 * call sat out a pointless minute and the user was told to retry in one.
 */
function parseRateLimit(body: string): { retryAfterMs?: number; daily: boolean } {
  let retryAfterMs: number | undefined
  const rpc = body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/)
  const text = body.match(/retry in\s+(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+(?:\.\d+)?)s)?/i)
  if (rpc) {
    retryAfterMs = Math.ceil(parseFloat(rpc[1]) * 1000)
  } else if (text && (text[1] || text[2] || text[3])) {
    retryAfterMs = Math.ceil(
      ((Number(text[1] ?? 0) * 60 + Number(text[2] ?? 0)) * 60 + parseFloat(text[3] ?? "0")) * 1000,
    )
  }
  const daily =
    /PerDay|per day/i.test(body) ||
    // Anything longer than a few minutes is not a per-minute window.
    (retryAfterMs !== undefined && retryAfterMs > 10 * 60_000)
  return { retryAfterMs, daily }
}

/** Response shape we depend on — everything else in the payload is ignored. */
interface InteractionResponse {
  status?: string
  steps?: Array<{
    type?: string
    content?: Array<{ type?: string; text?: string }>
  }>
}

interface GenerateOptions {
  prompt: string
  model?: string
  /**
   * Thinking tokens count against this budget, so it must leave room for both
   * the reasoning and the answer. Too tight and the call returns a completed
   * interaction with zero text blocks.
   */
  maxOutputTokens?: number
  /** Pro defaults to "high"; drop to "low" for mechanical, non-reasoning calls. */
  thinkingLevel?: "minimal" | "low" | "medium" | "high"
  systemInstruction?: string
  timeoutMs?: number
}

/**
 * One-shot text generation. Returns the model's text, already joined across
 * consecutive text blocks and with thinking steps excluded.
 *
 * Throws GeminiError with a normalized code so callers can map to the same
 * user-facing errors the Anthropic path uses.
 */
export async function generateWithGemini(
  apiKey: string,
  {
    prompt,
    model = GEMINI_PRIMARY_MODEL,
    maxOutputTokens = 4096,
    thinkingLevel = "high",
    systemInstruction,
    timeoutMs = 90_000,
  }: GenerateOptions,
): Promise<string> {
  let res: Response
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
        "Api-Revision": API_REVISION,
      },
      body: JSON.stringify({
        model,
        input: prompt,
        ...(systemInstruction ? { system_instruction: systemInstruction } : {}),
        generation_config: {
          thinking_level: thinkingLevel,
          max_output_tokens: maxOutputTokens,
          // Temperature is deliberately unset — Google warns that lowering it
          // off the 1.0 default degrades Gemini 3 reasoning.
        },
        // Nothing about a user's hooks needs to live on Google's servers.
        store: false,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // A timeout is functionally an overload from the caller's perspective:
    // retrying on the faster model is the right recovery.
    throw new GeminiError("overloaded", `Gemini request failed: ${msg}`)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    const detail = body.slice(0, 300).replace(/\s+/g, " ").trim()
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      throw new GeminiError("invalid_key", `Gemini rejected the key (${res.status}): ${detail}`, res.status)
    }
    if (res.status === 429) {
      const err = new GeminiError("quota", `Gemini quota exceeded: ${detail}`, res.status)
      const limit = parseRateLimit(body)
      err.retryAfterMs = limit.retryAfterMs
      err.daily = limit.daily
      throw err
    }
    if (res.status >= 500) {
      throw new GeminiError("overloaded", `Gemini returned ${res.status}: ${detail}`, res.status)
    }
    throw new GeminiError("unknown", `Gemini returned ${res.status}: ${detail}`, res.status)
  }

  let data: InteractionResponse
  try {
    data = (await res.json()) as InteractionResponse
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new GeminiError("unknown", `Gemini response was not JSON: ${msg}`)
  }

  const text = extractText(data)
  if (!text.trim()) {
    // Most often a max_output_tokens budget the thinking pass ate whole.
    throw new GeminiError(
      "empty",
      `Gemini returned no text (status=${data.status ?? "unknown"}, steps=${data.steps?.length ?? 0})`,
    )
  }
  return text
}

/**
 * ONE request per call, on Flash. No Pro attempt, no fallback, no retry.
 *
 * This used to try Pro first and fall back to Flash, and later also retried
 * Flash after a rate limit. On a free-tier key Pro's limit is zero, so every
 * hook cost two to three requests against a budget of 5 a minute and 20 a
 * day — Hani burned two keys' daily allowance in one morning without a
 * single hook saved (2026-10-08). Her rule: a round of 6 hooks sends 6
 * requests, never more. Flash is the model every key can reach.
 *
 * The name and return shape are kept so callers don't change; `fallback` is
 * always false now.
 */
export async function generateWithGeminiFallback(
  apiKey: string,
  {
    fallbackTimeoutMs,
    ...opts
  }: Omit<GenerateOptions, "model"> & {
    /** Kept for callers; Flash is the only call now, so this caps it when set. */
    fallbackTimeoutMs?: number
  },
): Promise<{ text: string; fallback: boolean; model: string }> {
  const text = await generateWithGemini(apiKey, {
    ...opts,
    model: GEMINI_WRITER_MODEL,
    ...(fallbackTimeoutMs ? { timeoutMs: fallbackTimeoutMs } : {}),
  })
  return { text, fallback: false, model: GEMINI_WRITER_MODEL }
}

/**
 * Pull the answer out of the `steps` timeline: model_output steps only, so
 * thinking blocks never leak into a hook.
 */
function extractText(data: InteractionResponse): string {
  const parts: string[] = []
  for (const step of data.steps ?? []) {
    if (step.type !== "model_output") continue
    for (const block of step.content ?? []) {
      if (block.type === "text" && typeof block.text === "string") parts.push(block.text)
    }
  }
  return parts.join("").trim()
}

/**
 * Maps a Gemini failure to the error codes the hook routes already return, so
 * the existing client-side error banners keep working unchanged.
 */
export function geminiErrorCode(err: unknown): string {
  if (err instanceof GeminiError) {
    if (err.code === "invalid_key") return "gemini_key_invalid"
    if (err.code === "quota") return err.daily ? "gemini_daily_limit" : "gemini_quota_exceeded"
    if (err.code === "overloaded") return "gemini_overloaded"
  }
  return ""
}
