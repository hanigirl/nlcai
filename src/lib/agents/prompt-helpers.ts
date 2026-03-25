import type { CoreIdentity, AudienceIdentity } from "./types"

export function buildIdentitySection(coreIdentity?: CoreIdentity | null): string {
  if (!coreIdentity) return ""
  return `
## סגנון הכתיבה של המשתמש
- איך נשמע/ת: ${coreIdentity.how_i_sound}
${coreIdentity.slang_examples ? `- סלנג וביטויים: ${coreIdentity.slang_examples}` : ""}- מה אף פעם לא עושה: ${coreIdentity.what_i_never_do}
- נישה: ${coreIdentity.niche}
`
}

export function buildAudienceSection(audienceIdentity?: AudienceIdentity | null): string {
  if (!audienceIdentity) return ""
  return `
## קהל היעד
- כאבים: ${audienceIdentity.daily_pains}
- רצונות: ${audienceIdentity.daily_desires}
- שפת הקהל: ${audienceIdentity.cross_audience_quotes}
`
}
