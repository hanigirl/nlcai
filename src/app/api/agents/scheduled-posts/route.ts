import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Read-only window into the calendar for agents that run without a browser
 * session — today that means Chandler, Phebe's newsletter agent, which wakes
 * up every מוצאי שבת in GitHub Actions and turns the week's posts into a
 * newsletter.
 *
 * Auth is a shared secret in `x-agent-secret`, not a user session: there is no
 * cookie in a cron run. The secret buys read access to exactly one user's
 * board — the account named by AGENT_USER_EMAIL — and nothing else. It never
 * writes, and it never returns another user's rows.
 *
 * GET /api/agents/scheduled-posts?from=YYYY-MM-DD&to=YYYY-MM-DD
 *   from/to are inclusive; both default to today.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

type ScheduledRow = {
  core_post_id: string
  format: string
  scheduled_date: string
  scheduled_time: string
  published_at: string | null
  hook: string | null
}

type CorePostRow = {
  id: string
  title: string | null
  body: string | null
  hook_text: string | null
  idea_text: string | null
  status: string | null
  created_at: string
}

type VariantRow = {
  core_post_id: string
  format: string
  body: string | null
}

function todayJerusalem(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

/**
 * Constant-time-ish comparison. Overkill for a personal tool, cheap enough to
 * not think about again.
 */
function secretMatches(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return diff === 0
}

export async function GET(req: NextRequest) {
  const expected = process.env.AGENT_API_SECRET
  if (!expected) {
    return NextResponse.json(
      { error: "AGENT_API_SECRET is not configured" },
      { status: 500 },
    )
  }
  const provided = req.headers.get("x-agent-secret") ?? ""
  if (!secretMatches(provided, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const agentEmail = process.env.AGENT_USER_EMAIL
  if (!agentEmail) {
    return NextResponse.json(
      { error: "AGENT_USER_EMAIL is not configured" },
      { status: 500 },
    )
  }

  const { searchParams } = new URL(req.url)
  const today = todayJerusalem()
  const from = searchParams.get("from") ?? today
  const to = searchParams.get("to") ?? today
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json(
      { error: "from/to must be YYYY-MM-DD" },
      { status: 400 },
    )
  }

  const supabase = createAdminClient()

  const { data: userData, error: userError } = await supabase
    .from("users")
    .select("id")
    .eq("email", agentEmail)
    .maybeSingle()

  if (userError) {
    return NextResponse.json({ error: userError.message }, { status: 500 })
  }
  // Cast per the repo's admin-client convention — the Database generic widens
  // service-role reads to `never`.
  const userRow = userData as { id: string } | null
  if (!userRow) {
    return NextResponse.json(
      { error: `No user for AGENT_USER_EMAIL (${agentEmail})` },
      { status: 404 },
    )
  }

  const { data: scheduled, error: scheduledError } = await supabase
    .from("scheduled_posts")
    .select("core_post_id, format, scheduled_date, scheduled_time, published_at, hook")
    .eq("user_id", userRow.id)
    .gte("scheduled_date", from)
    .lte("scheduled_date", to)
    .order("scheduled_date", { ascending: true })

  if (scheduledError) {
    return NextResponse.json({ error: scheduledError.message }, { status: 500 })
  }

  const rows = (scheduled ?? []) as ScheduledRow[]
  if (rows.length === 0) {
    return NextResponse.json({ from, to, posts: [] })
  }

  const postIds = [...new Set(rows.map((r) => r.core_post_id))]

  const [{ data: posts, error: postsError }, { data: variants }] =
    await Promise.all([
      supabase
        .from("core_posts")
        .select("id, title, body, hook_text, idea_text, status, created_at")
        .in("id", postIds),
      supabase
        .from("format_variants")
        .select("core_post_id, format, body")
        .in("core_post_id", postIds),
    ])

  if (postsError) {
    return NextResponse.json({ error: postsError.message }, { status: 500 })
  }

  const postById = new Map(
    ((posts ?? []) as CorePostRow[]).map((p) => [p.id, p]),
  )
  const variantByKey = new Map(
    ((variants ?? []) as VariantRow[]).map((v) => [
      `${v.core_post_id}::${v.format}`,
      v,
    ]),
  )

  // One entry per calendar slot. The agent gets both the format-specific
  // script and the post-level body: a carousel and a talking-head of the same
  // idea read very differently, and `body` is the fallback when a format was
  // scheduled before its own script was written.
  const out = rows.map((row) => {
    const post = postById.get(row.core_post_id)
    const variant = variantByKey.get(`${row.core_post_id}::${row.format}`)
    return {
      corePostId: row.core_post_id,
      format: row.format,
      scheduledDate: row.scheduled_date,
      scheduledTime: row.scheduled_time,
      publishedAt: row.published_at,
      title: post?.title ?? null,
      hook: row.hook ?? post?.hook_text ?? null,
      ideaText: post?.idea_text ?? null,
      body: post?.body ?? null,
      formatBody: variant?.body ?? null,
      postStatus: post?.status ?? null,
      postCreatedAt: post?.created_at ?? null,
    }
  })

  return NextResponse.json({ from, to, posts: out })
}
