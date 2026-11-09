const NEED_WORDS: Record<string, string> = {
  avatar: "תמונת פרופיל",
  name: "השם שיופיע",
  handle: "ה-@ שלכם באינסטגרם",
  photo: "תמונה שלכם או של המוצר",
}

/** The chat's ask for exactly what's missing. */
export function missingMessage(missing: string[]): string {
  const words = missing.map((m) => NEED_WORDS[m]).filter(Boolean)
  const list = words.length === 1 ? words[0] : `${words.slice(0, -1).join(", ")} ו${words[words.length - 1]}`
  const attach = missing.includes("avatar") || missing.includes("photo")
  const write = missing.includes("name") || missing.includes("handle")
  const how = [
    attach ? `צרפו ${missing.includes("avatar") ? "תמונת פרופיל" : "את התמונה"}` : "",
    write ? `כתבו ${missing.includes("name") && missing.includes("handle") ? "את השם ואת ה-@" : missing.includes("name") ? "את השם" : "את ה-@"}` : "",
  ]
    .filter(Boolean)
    .join(" ו")
  return `כדי שזה ייראה כמו ברפרנס חסרים לי ${list}. ${how}, ואמשיך.`
}
