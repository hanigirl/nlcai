import Anthropic from "@anthropic-ai/sdk"
import type { BrandStyle } from "@/lib/supabase/types"

const SYSTEM_PROMPT = `You are an expert visual designer analyzing social media cover images (reels, stories, carousels) to extract a precise, reusable visual style specification.

You will receive 3-6 cover images from the same brand. Scan each image carefully and document the following in order:

## Step 1: Font Analysis
- **font_name**: Identify the font or the closest match (e.g., "Rubik", "Heebo", "Assistant", "Secular One"). If unsure, pick the closest Google Font that supports Hebrew.
- **font_size_px**: THIS IS CRITICAL. Estimate the font size in pixels assuming the cover is 1080px wide and 1920px tall.
  **How to measure**: Look at a single letter's height relative to the total cover height. If a letter takes up ~5% of the cover height (96px), that's a small font. If it takes up ~10-15% (190-290px), that's a large, dominant headline. Most viral reel covers use VERY large text — 150px to 250px+ — where each word takes up most of the width.
  Common ranges:
  - Small/subtitle: 44-60px
  - Medium: 60-100px
  - Large headline: 100-160px
  - HUGE/dominant (fills the screen): 160-280px
  Look at how much of the cover width a single word occupies. If one word like "פוסטים" fills 70-90% of the width, that's 200px+. Do NOT underestimate — most reel covers use enormous text.
- **font_weight**: "extra-bold", "bold", "regular", or "light". Look at the thickness of the strokes. Most viral covers use "extra-bold" or "bold".
- **text_color**: Sample the EXACT color of the text from the image. Return a precise hex value — don't guess #FFFFFF, actually look at the pixel color. It might be slightly off-white, yellow-tinted, etc.
- **text_shadow**: Does the text have a drop shadow or glow behind it? (true/false)
- **text_shadow_color**: If there's a shadow, what color is it? Hex string.

## Step 2: Text Layout
- **text_position**: Where on the cover is the text placed? "center", "bottom-center", "top", "bottom-left", "bottom-right", "top-left", "top-right". Note: if the text spans the ENTIRE lower half or more of the cover, that's "center" or "bottom-center" with a very large font.
- **text_size**: Relative classification based on how much of the cover the text FILLS:
  - "large" — text fills most of the cover area, each word nearly the full width. THIS IS MOST COMMON for reel covers.
  - "medium" — moderate headlines, takes about 50-60% of width
  - "small" — smaller text, subtitle-like
- **line_height**: The spacing between lines of text, as a multiplier of font size. Measure the distance between the baseline of one line and the baseline of the next, divided by the font size.
  - 0.9-1.0 = lines are very tight, almost touching or overlapping — common in bold reel covers where text is stacked tightly
  - 1.1-1.2 = compact but readable
  - 1.3-1.5 = normal/comfortable spacing
  Look carefully — many viral reel covers use very tight line spacing (0.9-1.1) to create a dense, impactful text block.
- **letter_spacing**: The spacing between individual letters within a word, as an em value.
  - -0.05 to -0.02 = tightly packed letters (common in bold Hebrew headlines)
  - 0 = normal/default spacing
  - 0.02-0.05 = slightly spaced out
  - 0.1+ = wide tracking
  Look at how close or far apart the letters are within each word. Bold Hebrew text often uses tight or zero letter spacing.
- **text_align**: How is the text aligned horizontally within its container?
  - "center" — text is centered (very common for reel covers)
  - "right" — text is right-aligned (common for RTL but not always)
  - "left" — text is left-aligned
  Look carefully at multi-line text — if all lines are centered relative to each other, it's "center". If they all start from the same right edge, it's "right".
- **avg_words_per_line**: Count how many words appear per line ON AVERAGE across all images. This is critical for line breaking. If most covers have 1-2 words per line with huge text, return 1.5. If 2-3 words, return 2.5. Look carefully — large text means fewer words per line.
- **text_direction**: "rtl" for Hebrew/Arabic, "ltr" for English.

## Step 3: Overlay Analysis
Look at what's BEHIND the text, between the text and the background image:
- **overlay_style**:
  - "none" — no overlay, text sits directly on the image
  - "solid" — a flat color overlay covering the entire image or a large portion
  - "gradient" — a gradient overlay (e.g., dark at bottom fading to transparent)
  - "semi-transparent" — a very subtle darkening
  - "blur" — the image is blurred behind the text area
- **overlay_opacity**: Be VERY precise. Sample the darkest area of the overlay and estimate its opacity. 0.0 = fully transparent, 1.0 = fully opaque. Most covers use 0.15-0.4. If you can clearly see the image through the overlay, it's likely 0.15-0.25.
- **overlay_color**: The color of the overlay. Sample it from the image — it might not be pure black. Could be dark blue, dark purple, etc. Hex string.
- **overlay_gradient_direction**: If gradient, describe the direction: "bottom-to-top", "top-to-bottom", "left-to-right", etc.
- **overlay_gradient_from**: The starting color of the gradient (the opaque end). Hex with alpha info in the description.
- **overlay_gradient_to**: The ending color (the transparent end).

## Step 4: Text Background (Pill/Box)
This is SEPARATE from the image overlay. Some covers have a colored box or pill shape directly behind the text:
- **has_text_background**: true/false
- **text_background_color**: The color of the box. Hex string.
- **text_background_opacity**: How opaque is the box? 0.0-1.0
- **text_background_border_radius**: Estimated corner radius in pixels (0 = sharp, 16 = rounded, 999 = pill)

## Step 5: Colors
Sample colors DIRECTLY from the images — do not guess:
- **accent_color**: A recurring accent color used for highlights, decorations, underlines. Hex or null.
- **secondary_color**: A secondary brand color if present. Hex or null.

## Step 6: Recurring Elements
- **has_recurring_elements**: Do the covers have recurring graphic elements like logos, icons, stickers, frames, or decorative shapes? (true/false)
- **recurring_elements_description**: Describe what they are briefly (e.g., "small logo in top-right corner", "yellow underline under headline", "circular frame around avatar"). Or null.

## Rules
- Look for CONSISTENCY across all images. Report the average/dominant pattern.
- SAMPLE colors from the actual pixels — don't assume white is #FFFFFF.
- Be precise with opacity — this directly affects the final cover quality.
- For gradient overlays, describe exactly how the gradient spreads.
- Return ONLY a valid JSON object. No markdown fences, no explanation.`

export async function analyzeBrandStyle(
  apiKey: string,
  images: string[],
): Promise<BrandStyle> {
  const anthropic = new Anthropic({ apiKey })

  const content: Anthropic.Messages.ContentBlockParam[] = []

  for (const img of images.slice(0, 6)) {
    const dataMatch = img.match(/^data:(image\/\w+);base64,(.+)$/)
    if (dataMatch) {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: dataMatch[1] as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
          data: dataMatch[2],
        },
      })
    } else if (img.startsWith("http")) {
      content.push({
        type: "image",
        source: { type: "url", url: img },
      })
    }
  }

  content.push({
    type: "text",
    text: "Analyze these cover images step by step as specified in your instructions. Return the JSON result.",
  })

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
  })

  const text = response.content[0].type === "text" ? response.content[0].text : ""

  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error("Failed to parse style analysis")

  return JSON.parse(jsonMatch[0]) as BrandStyle
}
