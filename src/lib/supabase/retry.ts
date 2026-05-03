// Retry wrapper for Supabase calls. Why: a single transient blip (mobile
// network, Supabase 5xx, dropped DB connection) was silently dropping hook
// inserts. Now we retry on transient errors only; permanent errors (RLS,
// validation, conflict) bail immediately so we don't waste time on calls that
// can't succeed.
//
// Idempotency note: callers that mutate state (insert) should pass a stable
// pre-generated `id` so a half-success — first attempt committed, response
// lost — fails the retry with a unique violation, which we treat as success
// rather than creating a duplicate row.

interface SupabaseLikeResult<T> {
  data: T | null
  error: { message?: string; code?: string; details?: string | null } | null
}

interface RetryOpts {
  maxAttempts?: number
  baseDelayMs?: number
  /** Postgres error code that means "this row is already there", which for an
   *  idempotent insert means an earlier attempt won. Default: 23505 (unique
   *  violation). Pass `null` to disable. */
  treatAsSuccessCode?: string | null
}

const TRANSIENT_PATTERNS = [
  /fetch failed/i,
  /network/i,
  /timeout/i,
  /timed out/i,
  /econn(reset|refused|aborted)/i,
  /socket hang up/i,
  /terminated/i,
  /\b50[234]\b/, // 502/503/504
]

// Postgres connection-level codes worth retrying.
const TRANSIENT_PG_CODES = new Set([
  "57P03", // cannot_connect_now
  "57P01", // admin_shutdown
  "08006", // connection_failure
  "08003", // connection_does_not_exist
  "08001", // sqlclient_unable_to_establish_sqlconnection
  "53300", // too_many_connections
])

function isTransient(err: { message?: string; code?: string }): boolean {
  if (err.code && TRANSIENT_PG_CODES.has(err.code)) return true
  const msg = err.message ?? ""
  return TRANSIENT_PATTERNS.some((re) => re.test(msg))
}

export async function withRetry<T>(
  // PromiseLike, not Promise: Supabase query builders are thenable but not
  // full Promises. Awaiting them works, but the type doesn't satisfy Promise<T>.
  fn: () => PromiseLike<SupabaseLikeResult<T>>,
  opts: RetryOpts = {},
): Promise<SupabaseLikeResult<T>> {
  const maxAttempts = opts.maxAttempts ?? 3
  const baseDelay = opts.baseDelayMs ?? 200
  const successCode = opts.treatAsSuccessCode === undefined ? "23505" : opts.treatAsSuccessCode

  let last: SupabaseLikeResult<T> = { data: null, error: { message: "no attempts run" } }
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn()
      if (!result.error) return result
      // Half-success on retry — earlier attempt actually committed.
      if (successCode && result.error.code === successCode && attempt > 1) {
        return { data: result.data, error: null }
      }
      last = result
      if (!isTransient(result.error) || attempt === maxAttempts) return result
    } catch (thrown) {
      const err = thrown instanceof Error ? { message: thrown.message } : { message: String(thrown) }
      last = { data: null, error: err }
      if (!isTransient(err) || attempt === maxAttempts) return last
    }
    await new Promise((r) => setTimeout(r, baseDelay * 2 ** (attempt - 1)))
  }
  return last
}
