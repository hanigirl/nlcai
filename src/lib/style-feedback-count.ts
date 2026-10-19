export const LIKE_THRESHOLD = 5;

const storageKey = (signature: string) => `style-feedback-likes:${signature}`;

export function getLikeCount(signature: string): number {
  try {
    const raw = localStorage.getItem(storageKey(signature));
    if (raw === null) return 0;
    const parsed = parseInt(raw, 10);
    return isNaN(parsed) ? 0 : parsed;
  } catch {
    return 0;
  }
}

export function incrementLikeCount(signature: string): number {
  const newCount = getLikeCount(signature) + 1;
  try {
    localStorage.setItem(storageKey(signature), String(newCount));
  } catch {
    // ignore storage errors
  }
  return newCount;
}

export function resetLikeCount(signature: string): void {
  try {
    localStorage.removeItem(storageKey(signature));
  } catch {
    // ignore storage errors
  }
}

export function hasReachedThreshold(signature: string): boolean {
  return getLikeCount(signature) >= LIKE_THRESHOLD;
}