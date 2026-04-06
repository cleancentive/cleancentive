# Design Tokens

All colors are defined as CSS custom properties in [`frontend/src/index.css`](../frontend/src/index.css). Never use raw hex values in components — always reference a token.

## Primitive scales

Based on Tailwind's color palette. Use these when no semantic token fits.

| Scale | Values |
|-------|--------|
| Blue | 50, 100, 200, 500, 600, 700, 800 |
| Indigo | 50, 200, 300, 500, 600 |
| Emerald | 50, 100, 200, 500, 600, 700, 800 |
| Red | 50, 100, 200, 300, 500, 600, 700 |
| Amber | 100, 200, 500, 600, 800 |
| Slate | 50, 100, 200, 400, 500, 600, 800, 900 |
| Gray | 100, 200, 300, 400, 500, 600, 700, 800, 900 |
| Violet | 600 |

## Semantic tokens

Use these whenever the intent matches — they keep the UI consistent and make theming possible.

| Token | Resolves to | Use for |
|-------|-------------|---------|
| `--color-primary` | blue-600 | Brand actions, links, primary buttons |
| `--color-primary-hover` | blue-700 | Hover state for primary |
| `--color-primary-subtle` | blue-50 | Light primary backgrounds |
| `--color-primary-border` | blue-200 | Borders on primary-tinted surfaces |
| `--color-accent` | indigo-500 | Filter chrome, "My" chip |
| `--color-success` | emerald-600 | Positive outcomes, online status |
| `--color-danger` | red-600 | Errors, destructive actions |
| `--color-warning` | amber-600 | Caution states |
| `--color-cta` | amber-500 | Guest sign-in prompts, attention-grabbing actions |
| `--color-highlight` | amber-500 | Active filter indicators, selection highlights |
| `--color-text` | gray-800 | Body text |
| `--color-text-muted` | gray-500 | Secondary text, labels |
| `--color-text-faint` | gray-400 | Tertiary text, placeholders |
| `--color-surface` | white | Card/panel backgrounds |
| `--color-surface-alt` | slate-50 | Alternate backgrounds |
| `--color-surface-hover` | gray-100 | Hover state backgrounds |
| `--color-border` | gray-200 | Default borders |
| `--color-border-input` | gray-300 | Form input borders |

Each semantic token also has `-subtle` (tinted background) and `-border` (border on tinted surface) variants where applicable.

## Entity-type tokens

Each domain entity has a distinct color on the map and in the UI.

| Entity | Base color | Token prefix | Meaning |
|--------|-----------|--------------|---------|
| Spot | Red | `--color-entity-spot` | Litter not yet picked up — "needs action" |
| Pick | Green | `--color-entity-pick` | Collected litter — "positive outcome" |
| Cleanup | Blue | `--color-entity-cleanup` | Organized events — brand color |

Each entity has `-light`, `-dark`, and `-subtle` variants for cluster shading and tinted backgrounds.

## Feedback status tokens

| Status | Token | Color |
|--------|-------|-------|
| New | `--color-status-new` | gray-500 |
| Acknowledged | `--color-status-acknowledged` | blue-500 |
| In progress | `--color-status-in-progress` | amber-500 |
| Resolved | `--color-status-resolved` | emerald-500 |

Centralized in [`frontend/src/lib/statusColors.ts`](../frontend/src/lib/statusColors.ts).

## Badge tokens

| Badge | Token | Color |
|-------|-------|-------|
| Partner | `--color-badge-partner` | violet-600 |
| Active | `--color-badge-active` | emerald-600 |

## Partner overrides

Partners can inject custom branding via CSS custom properties:

- `--partner-primary` — overrides the header and primary button color
- `--partner-accent` — overrides accent elements

The cascade: `--color-primary` reads from `--app-primary`, which defaults to `--blue-600`. Partners inject `--partner-primary` via custom CSS, and the header uses `var(--partner-primary, var(--app-primary))`.

## Guidelines

1. **Never use raw hex values** in components or App.css. Always use `var(--token-name)`.
2. **Prefer semantic tokens** over primitives when the intent matches (e.g., `--color-text-muted` over `--gray-500` for secondary text).
3. **Use primitives** when no semantic token fits (e.g., a specific shade for a one-off decorative element).
4. Hex values inside `var()` fallbacks (e.g., `var(--partner-primary, #2563eb)`) are intentional and should stay.
5. MapLibre GL expressions can't use CSS variables directly — resolve them at runtime with `getComputedStyle`.
