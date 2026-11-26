## Wireframe Fulfillment

The wireframes in `nodeIntents` ARE the layout. Fulfill each one in place:
- Call `update_component_code` with `targetId` set to the wireframe id and the complete TSX in `code`. Set `componentType` to a descriptive name (e.g. "PricingCard").
- Never call `draft_layout` for wireframes and never `add_component` a duplicate at new coordinates. Use `add_component` only for extra components the prompt explicitly asks for beyond the wireframes.
- Top-level wireframes are independent: one `update_component_code` per id, never merged into each other.
