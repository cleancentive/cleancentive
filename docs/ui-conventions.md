# UI Conventions

Frontend patterns we follow consistently across pages. Reach for an existing pattern before inventing a new one.

## Multi-value filters: toggle pills

For categorical filters with N options where "all" is meaningful:

- Render each option as an individual pill (toggle button).
- Default state: **all pills selected** (no filtering applied).
- Selecting a subset filters the data to those values.
- "All" is **implicit** (= all pills selected). Never render a separate "All" pill.
- Do not render a separate "Clear" / "Reset" button — clicking pills is enough; the affordance is self-explanatory.
- Pills should be visibly toggled (filled vs outlined, or strong vs muted background) so the active subset is obvious at a glance.

### Examples

- **Picked / Spotted** (status of a spot) — two pills, both selected by default. De-select "Spotted" to show only picks.
- **Processing status** (queued / processing / completed / failed) — four pills, all selected by default.

### Anti-pattern

Three mutually-exclusive buttons like `[ Picked | Spotted | All ]`. Problems:
- "All" duplicates the meaning of "all pills selected" — two ways to express the same state.
- Implies the values are mutually exclusive when they're not (a query can include both).
- Forces a single-select model that doesn't scale to N > 2 categories.
