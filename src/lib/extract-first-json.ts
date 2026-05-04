// Brace-counting extractor for the first complete {...} object in a string.
// Replaces the naive `/\{[\s\S]*\}/` regex, which spans across multiple objects
// when the model returns more than one (e.g., a doc describing two audiences),
// producing a comma-separated string that JSON.parse rejects.
export function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf("{")
  if (start < 0) return null
  let depth = 0
  let inStr = false
  let escape = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (escape) {
      escape = false
      continue
    }
    if (c === "\\") {
      escape = true
      continue
    }
    if (c === '"') {
      inStr = !inStr
      continue
    }
    if (inStr) continue
    if (c === "{") depth++
    else if (c === "}") {
      depth--
      if (depth === 0) return s.slice(start, i + 1)
    }
  }
  return null
}

export function hasMoreObjectsAfter(raw: string, firstJson: string): boolean {
  const remainder = raw.slice(raw.indexOf(firstJson) + firstJson.length).trim()
  return remainder.startsWith(",") || remainder.startsWith("{") || remainder.startsWith("[")
}
