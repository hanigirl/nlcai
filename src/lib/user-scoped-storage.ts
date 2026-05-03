// Per-user localStorage keys. Without scoping, switching accounts on the same
// browser causes cached hooks/ideas/canvas state from the previous user to
// surface for the next one.
export function userKey(base: string, userId: string | null | undefined): string {
  return userId ? `${base}:${userId}` : `${base}:anon`
}
