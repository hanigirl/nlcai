import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserApiKey } from "@/lib/api-keys";

const HEYGEN = "https://api.heygen.com/v3";

/** v3 lists are cursor-paginated at 50 a page. 10 pages is far past any real account. */
const MAX_PAGES = 10;

/**
 * An avatar the user owns, in the one shape the UI needs.
 *
 * On v3 every look, video or photo, is addressed the same way by
 * POST /v3/videos (`avatar_id` = the look id), so `type` no longer changes the
 * request. It is kept because the picker filters on it and clients already
 * send it back to /api/videos/generate.
 */
interface OwnedAvatar {
  avatar_id: string;
  avatar_name: string;
  preview_image_url: string;
  preview_video_url: string;
  type: "avatar" | "talking_photo";
}

interface Look {
  id: string;
  name: string;
  /** digital_twin / studio_avatar = recorded on video; photo_avatar = from a still. */
  avatar_type: "studio_avatar" | "digital_twin" | "photo_avatar";
  preview_image_url?: string | null;
  preview_video_url?: string | null;
  /** Only on private looks: processing | completed | failed. */
  status?: string | null;
}

export async function GET() {
  const supabase = await createClient();

  let apiKey: string;
  try {
    apiKey = await getUserApiKey(supabase, "heygen_api_key");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "heygen_not_connected") {
      return NextResponse.json({ error: "heygen_not_connected" }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 401 });
  }

  const headers = { "X-Api-Key": apiKey, Accept: "application/json" };

  const [avatars, voices] = await Promise.all([
    fetchOwnedAvatars(headers),
    fetchCustomVoices(headers),
  ]);

  return NextResponse.json({ avatars, voices });
}

/**
 * Follows a v3 list endpoint's `next_token` until `has_more` is false.
 * Throws on the first non-2xx so the caller decides what an outage means.
 */
async function listAll<T>(url: string, headers: Record<string, string>): Promise<T[]> {
  const out: T[] = [];
  let token: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const pageUrl: string = token ? `${url}&token=${encodeURIComponent(token)}` : url;
    const res = await fetch(pageUrl, { headers });
    if (!res.ok) throw new Error(`${url} returned ${res.status}`);
    const data = await res.json();
    out.push(...((data?.data ?? []) as T[]));
    token = data?.has_more ? (data?.next_token ?? null) : null;
    if (!token) break;
  }
  return out;
}

/**
 * The user's own recorded video avatars.
 *
 * `ownership=private` asks HeyGen for the looks that belong to this account,
 * so ownership is never guessed from the shape of an id. v3 also types each
 * look itself (`avatar_type`), which replaces the v2 trick of telling a video
 * avatar from a photo one by which id field it carried. A private group can
 * still mix both: Hani's "Hani Buskila in studio" holds one video avatar and
 * five photo looks, and only the first belongs on this screen.
 */
async function fetchOwnedAvatars(headers: Record<string, string>): Promise<OwnedAvatar[]> {
  let looks: Look[];
  try {
    looks = await listAll<Look>(`${HEYGEN}/avatars/looks?ownership=private&limit=50`, headers);
  } catch (err) {
    console.error("[api/avatars] look listing failed", err);
    return [];
  }

  // Video avatars only (Hani, 2026-08-12). This screen is "דיבור למצלמה" —
  // she wants the avatars she recorded herself on video, not the ones
  // generated from a photo or a look. Photo avatars are still normalized and
  // typed below, so surfacing them later is a matter of dropping this filter.
  const seen = new Set<string>();
  return looks
    .filter(isReady)
    .map(normalize)
    .filter((a) => a.type === "avatar")
    .filter((a) => {
      if (!a.avatar_id || seen.has(a.avatar_id)) return false;
      seen.add(a.avatar_id);
      return true;
    });
}

/**
 * A look still training has no thumbnail yet and is rejected if used, so
 * offering one means a blank tile that fails on click. HeyGen only reports
 * `status` on some looks, so a look without one passes.
 */
function isReady(look: Look): boolean {
  return typeof look.status !== "string" || look.status === "completed";
}

function normalize(look: Look): OwnedAvatar {
  return {
    avatar_id: look.id,
    avatar_name: look.name ?? "",
    preview_image_url: look.preview_image_url ?? "",
    preview_video_url: look.preview_video_url ?? "",
    type: look.avatar_type === "photo_avatar" ? "talking_photo" : "avatar",
  };
}

/** The voices the user cloned (`type=private`), not HeyGen's shared library. */
async function fetchCustomVoices(headers: Record<string, string>) {
  try {
    return await listAll<{ voice_id: string }>(`${HEYGEN}/voices?type=private&limit=100`, headers);
  } catch (err) {
    console.error("[api/avatars] voice listing failed", err);
    return [];
  }
}
