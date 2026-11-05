// Regression test for "Gemini busy → no hooks". Run with: npx tsx src/lib/gemini-stand-in.test.mts
//
// Standalone script, same convention as strip-dashes.test.mts (no test runner
// in this project yet). It feeds generateWithGemini the exact responses
// production saw and checks which ones let Claude write the round instead.
// Before 2026-11-05 only a 429 did, so Google's own "high demand" 503 and
// timeouts ended in "השרתים של Gemini עמוסים" with zero hooks.

import { claudeStandInReason, generateWithGemini, geminiErrorCode } from "./gemini"

type FakeResponse = { status: number; body: string } | { throws: Error }

function fakeFetch(r: FakeResponse) {
  globalThis.fetch = (async () => {
    if ("throws" in r) throw r.throws
    return new Response(r.body, { status: r.status })
  }) as typeof fetch
}

const timeout = new Error("The operation was aborted due to timeout")
timeout.name = "TimeoutError"

const cases: Array<[string, FakeResponse, ReturnType<typeof claudeStandInReason>]> = [
  [
    "503 high demand (verbatim from production, 2026-11-03)",
    {
      status: 503,
      body: '{"error":{"message":"gemini-3.6-flash is currently experiencing high demand, spikes in demand are usually temporary. Please try again later.","code":"service_unavailable"}}',
    },
    "busy",
  ],
  ["500 internal error", { status: 500, body: '{"error":{"message":"Internal error"}}' }, "busy"],
  ["request timed out", { throws: timeout }, "busy"],
  ["network failure", { throws: new TypeError("fetch failed") }, "busy"],
  [
    "429 daily cap",
    {
      status: 429,
      body: '{"error":{"message":"Rate limit exceeded for model gemini-3.6-flash (limit: 20 requests per day on Free Tier). Please retry in 15h26m48s"}}',
    },
    "quota",
  ],
  // A bad key must stay an error the user sees: covering it with Claude would
  // bill their Claude credits forever and hide that the key needs fixing.
  ["400 bad key", { status: 400, body: '{"error":{"message":"API key not valid"}}' }, null],
  ["403 forbidden", { status: 403, body: '{"error":{"message":"Permission denied"}}' }, null],
]

let failed = 0
for (const [name, response, expected] of cases) {
  fakeFetch(response)
  let reason: ReturnType<typeof claudeStandInReason> | "no error" = "no error"
  try {
    await generateWithGemini("test-key", { prompt: "x", timeoutMs: 1000 })
  } catch (err) {
    reason = claudeStandInReason(err)
  }
  const ok = reason === expected
  if (!ok) failed++
  console.log(`${ok ? "✓" : "✗"} ${name}: ${String(reason)}${ok ? "" : ` (expected ${String(expected)})`}`)
}

// Not a GeminiError at all (e.g. a Supabase failure) → never a stand-in.
{
  const reason = claudeStandInReason(new Error("overloaded"))
  const ok = reason === null
  if (!ok) failed++
  console.log(`${ok ? "✓" : "✗"} plain Error is not a stand-in: ${String(reason)}`)
}

// The user-facing code for a bad key is unchanged.
{
  fakeFetch({ status: 400, body: "{}" })
  let code = ""
  try {
    await generateWithGemini("test-key", { prompt: "x" })
  } catch (err) {
    code = geminiErrorCode(err)
  }
  const ok = code === "gemini_key_invalid"
  if (!ok) failed++
  console.log(`${ok ? "✓" : "✗"} bad key still reports gemini_key_invalid: ${code}`)
}

if (failed > 0) {
  console.error(`\n${failed} case(s) failed`)
  process.exit(1)
}
console.log("\nAll cases passed")
