/**
 * Test cases for the edit agent (PREP — see ./types.ts): every one is a bug
 * Hani hit on 2026-11-09 with today's planner, plus the gap she described.
 * Each says what she did and what a right outcome looks like — checked by
 * hand on her account (and later by an eval run against a fixture post).
 */

export interface AgentCase {
  id: string
  format: "story" | "carousel" | "image_post" | "b_roll"
  /** The situation, in short. */
  given: string
  /** Her message. */
  request: string
  /** What a right outcome is — not the steps. */
  expect: string[]
}

export const AGENT_CASES: AgentCase[] = [
  {
    id: "story-one-video-three-stories",
    format: "story",
    given: "Script has 3 stories. She attached ONE video from Drive.",
    request: "כתוביות על הסרטון ושים מוסיקה ברקע, הסרטון גם בשקופית הבאה",
    expect: [
      "3 frames, all her same video",
      "frame k carries script story k, word for word — no made-up title",
      "reply says what was done; if music isn't possible, says so plainly",
    ],
  },
  {
    id: "story-all-slides-correction",
    format: "story",
    given: "After a run that left 1 frame with story 1's caption.",
    request: "כתוביות על זה, זה סרטון לכל הסליידים",
    expect: ["acts on the CURRENT set (1 frame) → 3 frames", "each frame its own story", "never three identical clips"],
  },
  {
    id: "story-invented-title",
    format: "story",
    given: "Script has a hook as story 1.",
    request: "תוסיפי כתוביות",
    expect: ["frame 1 headline = the script's hook exactly", "no other headline anywhere"],
  },
  {
    id: "broll-invented-title",
    format: "b_roll",
    given: "B-roll script: a hook line + a reading caption. Her own clip.",
    request: "תוסיפי את הכיתוב",
    expect: ["the clip carries the script's hook + caption, word for word", "no new title"],
  },
  {
    id: "image-post-updated-script",
    format: "image_post",
    given: "AI-made image; she edited the script's headline afterwards.",
    request: "ג׳נרט מחדש עם הטקסט המעודכן",
    expect: ["the image's words become the CURRENT script's", "if nothing changed, the reply says so — never 'updated'"],
  },
  {
    id: "carousel-fewer-pictures",
    format: "carousel",
    given: "Script has 6 slides. She attached 3 pictures.",
    request: "תעשי קרוסלה מהתמונות",
    expect: [
      "asks ONE question with options: design the missing 3 in her style / her pictures repeated / she uploads more",
      "after her pick: 6 slides, slide k = script slide k",
    ],
  },
  {
    id: "carousel-unclear-picture",
    format: "carousel",
    given: "6 slides exist. She attached 1 picture, said nothing about where.",
    request: "תוסיפי את זה",
    expect: ["asks where (new slide / replace slide N / as an element on every slide) unless the history already says"],
  },
  {
    id: "own-pixels-refusal",
    format: "story",
    given: "Frame 2 is her photo.",
    request: "תבהירי את התמונה בפריים 2",
    expect: ["does not touch her pixels", "offers what it can do instead (caption, a new AI frame next to it)"],
  },
  {
    id: "reload-mid-edit",
    format: "story",
    given: "An animated caption is rendering; she reloads the page.",
    request: "(reload)",
    expect: ["the run keeps going on the server", "the result and reply are there when she comes back"],
  },
]
