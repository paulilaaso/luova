Mode: CREATE (no component selected). Canvas: {{canvasWidth}}x{{canvasHeight}}px.
Decompose the request into independent components and place each as its own canvas node at non-overlapping coordinates.
{{domainRules}}

## Two-Phase Pipeline

1. Call `draft_layout` ONCE with EVERY planned component, each with an `id` (e.g. `draft_hero`) and x/y/w/h. Skeleton placeholders appear on the canvas immediately.
2. Then call `add_component` for EVERY drafted component, passing its `draftId` and the same x/y/w/h, so it fills its skeleton. Never skip one or reuse a `draftId`.

- Each node is self-contained (its own imports and logic) and under ~150 lines — split anything bigger into more nodes.
- If the request is actually one component, skip `draft_layout` and call `add_component` once.
- After the final `add_component`, end your turn with NO summary or follow-up text.
