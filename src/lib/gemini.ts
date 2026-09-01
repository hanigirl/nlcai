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
  constructor(code: GeminiErrorCode, message: string, status?: number) {
    super(message)
    this.name = "GeminiError"
    this.code = code
    this.status = status
  }
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
      throw new GeminiError("quota", `Gemini quota exceeded: ${detail}`, res.status)
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
 * Pro first, Flash second. Returns whether the fallback fired so routes can
 * tell the client.
 *
 * Retries on ANY Pro failure, deliberately — unlike the Sonnet→Haiku fallback
 * this mirrors, the common case here isn't an overloaded server, it's a free
 * Gemini key that has no Pro access at all and gets 429/403 on every single
 * call. Narrowing this to 5xx would hand those users zero hooks and an
 * "invalid key" message for a key that is perfectly valid.
 *
 * If Flash fails too, Flash's error is what propagates — it's the model every
 * key can reach, so its failure is the one that actually describes the
 * user's problem.
 */
export async function generateWithGeminiFallback(
  apiKey: string,
  {
    fallbackTimeoutMs,
    ...opts
  }: Omit<GenerateOptions, "model"> & {
    /**
     * Cap for the Flash retry only. Pro and Flash aren't the same shape of
     * call — Pro thinks, Flash barely does — so one shared timeout either cuts
     * Pro off while it's still working or lets a stuck Flash call run long.
     * Defaults to the primary's cap, which is the previous behaviour.
     */
    fallbackTimeoutMs?: number
  },
): Promise<{ text: string; fallback: boolean; model: string }> {
  try {
    const text = await generateWithGemini(apiKey, { ...opts, model: GEMINI_PRIMARY_MODEL })
    return { text, fallback: false, model: GEMINI_PRIMARY_MODEL }
  } catch (err) {
    const code = err instanceof GeminiError ? err.code : "unknown"
    console.log(`[gemini] ${GEMINI_PRIMARY_MODEL} failed (${code}) — retrying on ${GEMINI_FALLBACK_MODEL}`)
    const text = await generateWithGemini(apiKey, {
      ...opts,
      model: GEMINI_FALLBACK_MODEL,
      ...(fallbackTimeoutMs ? { timeoutMs: fallbackTimeoutMs } : {}),
    })
    return { text, fallback: true, model: GEMINI_FALLBACK_MODEL }
  }
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
    if (err.code === "quota") return "gemini_quota_exceeded"
    if (err.code === "overloaded") return "gemini_overloaded"
  }
  return ""
}
