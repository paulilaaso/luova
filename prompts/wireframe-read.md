## Reading Wireframes

`nodeIntents` holds only top-level wireframes. Wireframes drawn inside one appear ONLY in its `nestedChildren` (also summarized in its comment), pre-sorted in spatial reading order, each with `relX`/`relY`/`w`/`h`, `widthPct`/`heightPct`, `h:`/`v:` anchors and a flow role.
- A wireframe with `nestedChildren` becomes ONE component: render every child as internal JSX in the listed order, even when unconventional (password above email stays that way). Never target a child id — children are consumed by their parent and deleted on fulfillment.
- Example: parent `wf-parent` with children [name input, password input, warning text] → one component rendering both `<input>`s and the `<p>`. Not three nodes.

### Intentional Geometry
- Keep clear asymmetry (unequal columns like 30%/70%, sidebars) instead of flattening into a centered `flex flex-col`. When children are roughly equal and centered, use a balanced layout — never invent off-center placements.
- Express proportions with resilient CSS — fractional grid tracks (`grid-cols-[1fr_2fr]`), proportional flex (`flex-[3]`), alignment utilities (`self-end`, `justify-between`). Never absolute px positioning; offsets are sequence, not coordinates.
- Snap jitter (within ~8% of the parent) to Tailwind spacing and near-center to `center`. Only edge-pinned placements >12% off-center are deliberate.
- Anchors are per-axis: `h:` sets horizontal alignment only, `v:` vertical only. In a column, differing `v:` values just mark sequence — never turn them into `justify-end`/`ml-auto` (and vice versa for rows).
- Siblings with equal widths and anchors render with identical classes at `w-full` — never shrink one or copy raw px (`w-[176px]`).
