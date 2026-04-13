# Project Instructions

## Design-to-Code Rules

When the user sends a design:

1. **Always use shadcn/ui components** (Card, Button, Input, Dialog, etc.) as building blocks
2. **Always map colors to the project's semantic tokens**, not raw hex values:
   - **Text:** `text-text-primary-default`, `text-text-primary-disabled`, `text-text-neutral-default`
   - **Buttons:** `bg-button-primary-default`, `hover:bg-button-primary-hover`, disabled: `bg-button-primary-disabled`, destructive: `bg-button-destructive-default`, `hover:bg-button-destructive-hover`
   - **Surfaces:** `bg-bg-surface` (neutral), `bg-bg-surface-primary-default` (yellow), `hover:bg-bg-surface-hover`
   - **Borders:** `border-border-neutral-default`
3. **Fall back to primitive tokens** (`yellow-XX`, `gray-XX`) when no semantic token fits
4. **Do not use default shadcn theme colors** — always override with the project's tokens
5. **Unknown colors:** If a design contains a color not in the token system, map it to the closest matching token (semantic first, then primitive). Never use arbitrary hex values.

## Reel Cover Generation Rules

When generating a reel cover:
- Always use the **hook text** as the cover title
- If the hook is too long (more than ~5 words), shorten it to a punchy 2-4 word version that captures the essence
- Keep the text bold, short, and attention-grabbing — like a headline
- Generate **exactly 1 cover** — no variations
- **Requires `brand_style`** — if the user has no brand_style in the DB, do NOT generate a cover. Show a message directing them to upload cover examples in Settings > Media > Covers
- The cover uses the user's `brand_style` (overlay, text color, position, size, font weight, direction) from the `users` table

## Design Tokens Reference

Primitives are defined in `src/app/globals.css` under `@theme inline`:
- Yellow scale: `yellow-10` (darkest) through `yellow-95` (lightest)
- Red scale: `red-50` (darkest) through `red-95` (lightest)
- Gray scale: `gray-10` (darkest) through `gray-98` (lightest)

Semantic tokens map primitives to usage:
- `text-primary-default` → gray-10
- `text-primary-disabled` → gray-70
- `text-neutral-default` → gray-50
- `button-primary-default` → yellow-10
- `button-primary-hover` → yellow-20
- `button-primary-disabled` → gray-90
- `button-destructive-default` → #F43D3D
- `button-destructive-hover` → #F10D0D
- `button-danger-default` → red-60
- `button-danger-hover` → red-50
- `button-danger-disabled` → red-90
- `text-danger-disabled` → red-80
- `bg-surface` → gray-98
- `bg-surface-primary-default` → yellow-95
- `bg-surface-primary-default-80` → yellow-80
- `bg-surface-hover` → yellow-90
- `border-neutral-default` → gray-90
