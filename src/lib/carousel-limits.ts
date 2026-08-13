/**
 * A carousel never runs past this many slides, hook and CTA included
 * (Hani, 2026-07-29).
 *
 * It lives on its own so the WRITER and the RENDERER cannot disagree. They
 * used to: the prompt said "one slide per topic, X topics means X slides"
 * with no ceiling at all, while the panel capped the count only at PNG time
 * by mechanically merging adjacent slides. A post with seven topics was
 * written as nine slides, shown to the user as nine slides, and only folded
 * down if and when they generated images — by a merge that had no idea what
 * the words meant.
 *
 * Condensing belongs to the model that is writing the words. This constant
 * is what tells it where to stop; `condenseSlides` stays behind it purely as
 * a backstop for a model that overshoots anyway.
 */
export const MAX_CAROUSEL_SLIDES = 6
