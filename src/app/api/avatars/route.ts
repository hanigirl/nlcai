import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserApiKey } from "@/lib/api-keys";

const HEYGEN = "https://api.heygen.com/v2";

/**
 * An avatar the user owns, in the one shape the UI needs.
 *
 * `type` matters downstream: HeyGen's video API takes a video avatar as
 * `{type:"avatar", avatar_id}` and a photo avatar as
 * `{type:"talking_photo", talking_photo_id}`. Getting it wrong is rejected at
 * generation time, so the picker has to carry the kind, not just the id.
 */
interface OwnedAvatar {
  avatar_id: string;
  avatar_name: string;
  preview_image_url: string;
  preview_video_url: string;
  type: "avatar" | "talking_photo";
}

interface AvatarGroup {
  id: string;
  name: string;
  /** PRIVATE = video avatar; PHOTO / GENERATED_PHOTO = talking photo. */
  group_type?: string;
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
 * The user's own recorded video avatars.
 *
 * Asks HeyGen which groups belong to this account (`include_public=false`)
 * and reads each group's looks, instead of guessing ownership from the shape
 * of an id. The old approach kept ids matching /^[0-9a-f]{32}$/ off
 * `/v2/avatars`; verified across all 12 connected accounts, that heuristic
 * happened to select exactly the same video avatars this does — but it was a
 * guess about id formatting, and it would go wrong the day HeyGen mints an id
 * that doesn't look like a UUID. This asks the question directly.
 */
async function fetchOwnedAvatars(headers: Record<string, string>): Promise<OwnedAvatar[]> {
  let groups: AvatarGroup[] = [];
  try {
    const res = await fetch(`${HEYGEN}/avatar_group.list?include_public=false`, { headers });
    if (!res.ok) throw new Error(`avatar_group.list returned ${res.status}`);
    const data = await res.json();
    groups = (data?.data?.avatar_group_list ?? data?.data?.avatar_groups ?? []) as AvatarGroup[];
  } catch (err) {
    console.error("[api/avatars] group listing failed, falling back to /v2/avatars", err);
    return fetchLegacyAvatars(headers);
  }

  const perGroup = await Promise.all(
    groups.map(async (group) => {
      try {
        const res = await fetch(`${HEYGEN}/avatar_group/${group.id}/avatars`, { headers });
        if (!res.ok) return [];
        const data = await res.json();
        const list = (data?.data?.avatar_list ?? []) as Record<string, unknown>[];
        return list.filter(isReady).map((raw) => normalize(raw, group));
      } catch (err) {
        console.error(`[api/avatars] group ${group.id} (${group.name}) failed`, err);
        return [];
      }
    }),
  );

  // Video avatars only (Hani, 2026-08-12). This screen is "דיבור למצלמה" —
  // she wants the avatars she recorded herself on video, not the ones
  // generated from a photo or a look. Photo avatars are still normalized and
  // typed above, so surfacing them later is a matter of dropping this filter.
  const seen = new Set<string>();
  return perGroup
    .flat()
    .filter((a) => a.type === "avatar")
    .filter((a) => {
      if (!a.avatar_id || seen.has(a.avatar_id)) return false;
      seen.add(a.avatar_id);
      return true;
    });
}

/**
 * Photo avatars carry a `status` while HeyGen is still training them —
 * "pending" looks have no thumbnail yet and are rejected if used, so offering
 * one means a blank tile that fails on click. Video avatars have no status
 * field at all, hence the undefined pass.
 */
function isReady(raw: Record<string, unknown>): boolean {
  return typeof raw.status !== "string" || raw.status === "completed";
}

/**
 * The two kinds return different field names for the same concepts — video
 * avatars use avatar_id/avatar_name/preview_image_url, photo avatars use
 * id/name/image_url. Flatten both into one shape here so nothing downstream
 * has to know the difference except when it builds the HeyGen character.
 *
 * The kind is decided per look, from its own fields — NOT from group_type.
 * A "PRIVATE" group is not the same thing as a group of video avatars: Hani's
 * "Hani Buskila in studio" holds one video avatar and five photo looks. Typing
 * by group would label those five as video avatars and HeyGen would reject
 * every one at generation time.
 */
function normalize(raw: Record<string, unknown>, group: AvatarGroup): OwnedAvatar {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const isVideoAvatar = typeof raw.avatar_id === "string" && raw.avatar_id.length > 0;

  return {
    avatar_id: isVideoAvatar ? str(raw.avatar_id) : str(raw.id),
    // The look's own name is usually the descriptive one ("Hani Buskila at her
    // desk"); the group name is the fallback for looks HeyGen auto-named badly.
    avatar_name: str(raw.avatar_name) || str(raw.name) || group.name,
    preview_image_url: str(raw.preview_image_url) || str(raw.image_url),
    preview_video_url: str(raw.preview_video_url) || str(raw.motion_preview_url),
    type: isVideoAvatar ? "avatar" : "talking_photo",
  };
}

/**
 * Previous behaviour, kept only for when the group endpoint is unavailable:
 * video avatars whose id looks like a custom UUID. Misses photo avatars, which
 * is exactly the bug this route was changed to fix — so it is a last resort,
 * not a code path we want taken.
 */
async function fetchLegacyAvatars(headers: Record<string, string>): Promise<OwnedAvatar[]> {
  const res = await fetch(`${HEYGEN}/avatars`, { headers });
  if (!res.ok) return [];
  const data = await res.json();
  const all = (data?.data?.avatars ?? []) as Record<string, unknown>[];
  const seen = new Set<string>();
  return all
    .filter((a) => typeof a.avatar_id === "string" && /^[0-9a-f]{32}$/.test(a.avatar_id))
    .filter((a) => {
      const id = a.avatar_id as string;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map((a) => ({
      avatar_id: a.avatar_id as string,
      avatar_name: typeof a.avatar_name === "string" ? a.avatar_name : "",
      preview_image_url: typeof a.preview_image_url === "string" ? a.preview_image_url : "",
      preview_video_url: typeof a.preview_video_url === "string" ? a.preview_video_url : "",
      type: "avatar" as const,
    }));
}

async function fetchCustomVoices(headers: Record<string, string>) {
  try {
    const res = await fetch(`${HEYGEN}/voices`, { headers });
    if (!res.ok) return [];
    const data = await res.json();
    const all = (data?.data?.voices ?? []) as { voice_id: string }[];
    return all.filter(
      (v) => /^[0-9a-f]{32}$/.test(v.voice_id) || /^[A-Za-z0-9]{20,}$/.test(v.voice_id),
    );
  } catch (err) {
    console.error("[api/avatars] voice listing failed", err);
    return [];
  }
}
