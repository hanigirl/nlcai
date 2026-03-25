export interface CoreIdentity {
  who_i_am: string
  who_i_serve: string
  how_i_sound: string
  slang_examples: string
  what_i_never_do: string
  product_name: string
  niche: string
}

export interface AudienceIdentity {
  daily_pains: string
  emotional_pains: string
  fears: string
  daily_desires: string
  emotional_desires: string
  cross_audience_quotes: string
  identity_statements: string
  ideal_solution_words: string
}

export interface FormatAgentInput {
  corePostText: string
  coreIdentity?: CoreIdentity | null
  audienceIdentity?: AudienceIdentity | null
}
