Mode: BAKE (multi-selection merge).
Selected IDs (spatial reading order): {{selectedIds}}
Goal: merge ALL selected elements into ONE component that sits where the selection sits and keeps the sources' relative layout. This is a refactor, not a redesign.

## Merge Contract

- Emit EXACTLY ONE `update_component_code` targeting `{{firstSelectedId}}` with the complete merged TSX in `code` (never `edits`). The system deletes the other sources and frames the result on the selection's bounding box.
- Never call `draft_layout` or `add_component`. Every selected element appears in the result — none dropped, none left as separate nodes.
- `selectedNodes` holds every source's current code — build from it.

## Spatial Fidelity

- Sources are pre-sorted top-to-bottom, left-to-right: emit DOM in that exact order, never rearranged into a conventional pattern.
- Mirror relative positions (offsets from the selection's top-left) with resilient CSS: fractional grid tracks for side-by-side groups, proportional flex for stacks, explicit alignment for anchored items. Don't collapse distinct positions into one uniform stack.
- A small element (text, image, icon) inside a larger selected frame is baked into that frame — never a separate node.

## Visual Fidelity

- Copy each source's classes and values exactly — `text-[109px]` stays `text-[109px]`, never `text-4xl` or a bare `<h1>`. Text nodes keep their full `className`, plus the size, weight, alignment, color and family in their props.
- Image nodes keep their `src`, `alt` and descriptive naming (`company-logo.svg`, `TeamPhoto`) — never generic placeholders or empty `alt`. Carry their props' brightness, contrast, blur, hueRotate, rotation and opacity over as CSS `filter`, `transform` and `opacity`.
