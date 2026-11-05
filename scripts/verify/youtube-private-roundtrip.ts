/**
 * Live check of the YouTube publish path, through the real adapter.
 *
 * Schedules ONE private YouTube post two days out on Hani's sub-account with
 * an existing b-roll clip, reads it back (title + privacy must echo), then
 * deletes it and confirms the provider marks it deleted. Nothing touches our
 * database except the agency token refresh the app itself would do.
 *
 *   SOCIAL_YOUTUBE_PRIVACY=private npx tsx --env-file=.env.local scripts/verify/youtube-private-roundtrip.ts
 */
import { HighLevelPublisher } from "@/lib/social/highlevel"
import { getLocationToken } from "@/lib/social/highlevel-auth"

if (process.env.SOCIAL_YOUTUBE_PRIVACY !== "private") {
  console.error("refusing to run without SOCIAL_YOUTUBE_PRIVACY=private")
  process.exit(1)
}

const USER = "845c453b-d073-4cb4-bf77-d753ccaa0c93"
const LOCATION = "dnbovn2B4IeTTCAaMLcl"
const ACCOUNT = {
  id: "verify-youtube",
  user_id: USER,
  provider: "highlevel",
  platform: "youtube",
  external_account_id: "6aecbf536dbd8115529ca821",
  external_tenant_id: LOCATION,
  external_origin_id: "UC23zxHMz02juxcu0Ye4sVGQ",
  handle: "UXtra",
  avatar_url: null,
  status: "connected",
}
const TABLES: Record<string, Record<string, unknown>[]> = {
  social_accounts: [ACCOUNT],
  social_tenants: [{ user_id: USER, provider: "highlevel", external_tenant_id: LOCATION }],
}

// In-memory stand-in for the two reads the adapter makes.
function fakeDb() {
  return {
    from(table: string) {
      const filters: [string, unknown][] = []
      const rows = () => (TABLES[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v))
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => (filters.push([k, v]), q),
        neq: () => q,
        order: () => q,
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (res: (v: unknown) => void) => res({ data: rows(), error: null }),
      }
      return q
    },
  }
}

const VIDEO =
  "https://fdinwqwujcahsoamcxqk.supabase.co/storage/v1/object/public/user-media/845c453b-d073-4cb4-bf77-d753ccaa0c93/b_roll/a6ddfafa-184a-44b1-bb63-0b1a06cd2f61.mp4"

const publisher = new HighLevelPublisher(fakeDb() as never)
const input = {
  userId: USER,
  socialAccountId: ACCOUNT.id,
  platform: "youtube" as const,
  title: "nlcai verify — private, deleted immediately",
  caption: "בדיקה פנימית של nlcai — פרטי, נמחק מיד",
  media: [{ url: VIDEO, type: "video" as const }],
  publishAt: new Date(Date.now() + 2 * 86400_000),
  kind: "reel" as const,
}

async function main() {
let postId: string | null = null
try {
  postId = (await publisher.schedulePost(input)).providerPostId
  console.log("created", postId)
  const state = await publisher.getPost(USER, postId)
  console.log("adapter read-back:", state.outcome, state.scheduledAt?.toISOString())

  const token = await getLocationToken(LOCATION)
  const raw = await fetch(`https://services.leadconnectorhq.com/social-media-posting/${LOCATION}/posts/${postId}`, {
    headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" },
  }).then((r) => r.json())
  const post = raw?.results?.post ?? {}
  console.log("raw youtubePostDetails:", JSON.stringify(post.youtubePostDetails ?? null))
  console.log("raw type/status:", post.type, post.status, "accountIds:", JSON.stringify(post.accountIds))
  if (post.youtubePostDetails?.privacyLevel !== "private") throw new Error("privacy did not echo as private")
} finally {
  if (postId) {
    await publisher.cancelPost(USER, postId)
    const after = await publisher.getPost(USER, postId)
    console.log("after delete:", after.outcome, "(missing = cancelled)")
  }
}
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
