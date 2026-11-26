import { z } from "zod";

export const aiModeSchema = z.enum([
  "create",
  "edit",
  "bake",
  "theme",
  "recreate",
]);

export const propertiesPanelTabSchema = z.enum(["components", "code", "theme"]);

const nodeSnapshotSchema = z.object({
  id: z.string(),
  type: z.string(),
  props: z.record(z.string(), z.unknown()),
  code: z.string(),
});

const nestedChildIntentSchema = z.object({
  id: z.string().describe("Child wireframe id — NEVER target directly."),
  type: z.string(),
  comment: z.string(),
  relX: z
    .number()
    .describe("X offset in px relative to the parent wireframe origin"),
  relY: z
    .number()
    .describe("Y offset in px relative to the parent wireframe origin"),
  w: z.number(),
  h: z.number(),
  widthPct: z
    .number()
    .optional()
    .describe(
      "Width share of the parent (0-100). Preserve as fractional grid/flex proportion."
    ),
  heightPct: z
    .number()
    .optional()
    .describe("Height share of the parent (0-100)."),
  hAnchor: z
    .enum(["start", "center", "end", "stretch"])
    .optional()
    .describe("Horizontal anchor in the parent frame."),
  vAnchor: z
    .enum(["start", "center", "end", "stretch"])
    .optional()
    .describe("Vertical anchor in the parent frame."),
  flowRole: z
    .enum(["column", "row-item", "grid-cell", "overlay", "solo"])
    .optional()
    .describe("Flow role within the parent."),
});

export const aiContextSnapshotSchema = z
  .object({
    mode: aiModeSchema,
    activeTab: propertiesPanelTabSchema,
    prompt: z.string(),
    selectedIds: z.array(z.string()),
    selectedNodes: z.array(nodeSnapshotSchema).optional(),
    themeTokenSources: z.record(z.string(), z.string()).optional(),
    sourceImage: z
      .object({
        nodeId: z.string().min(1),
        assetId: z.string().regex(/^asset:image-[a-zA-Z0-9]+$/),
        // Zod 4 numbers already reject Infinity and NaN.
        rect: z.object({
          x: z.number(),
          y: z.number(),
          w: z.number().positive(),
          h: z.number().positive(),
        }),
      })
      .optional(),
    canvasBounds: z
      .object({
        width: z.number(),
        height: z.number(),
      })
      .optional(),
    themeState: z
      .object({
        currentMode: z.enum(["light", "dark"]),
        styles: z.object({
          light: z.record(z.string(), z.string()),
          dark: z.record(z.string(), z.string()),
        }),
      })
      .optional(),
    nodeIntents: z
      .array(
        z.object({
          id: z.string().describe("Top-level wireframe id — fulfill this id."),
          kind: z.enum(["wireframe", "captured"]),
          type: z.string(),
          comment: z.string(),
          selector: z.string().optional(),
          label: z.string().optional(),
          sourceComponentId: z.string().optional(),
          sourceCode: z.string().optional(),
          rect: z.object({
            x: z.number(),
            y: z.number(),
            w: z.number(),
            h: z.number(),
          }),
          nestedChildren: z
            .array(nestedChildIntentSchema)
            .optional()
            .describe(
              "Nested wireframes, pre-sorted in spatial reading order — emit in this order as internal JSX of ONE composite component. NEVER target child ids."
            ),
        })
      )
      .optional()
      .describe(
        "Top-level wireframe intents only. Children live in nestedChildren — never target them."
      ),
  })
  .refine(
    (context) =>
      context.mode !== "recreate" ||
      (context.sourceImage != null &&
        context.selectedIds.length === 1 &&
        context.selectedIds[0] === context.sourceImage.nodeId),
    {
      message:
        "Recreate requires one selected source image and its canvas frame.",
    }
  );

const baseAiToolSchema = z.object({
  rationale: z.string().optional(),
  componentType: z
    .string()
    .optional()
    .describe(
      "A descriptive name for the component type being generated (e.g. 'Card', 'PricingTable', 'HolographicHero'). Used to apply correct sizing rules when fulfilling wireframe nodes."
    ),
  code: z.string().min(1),
});

export const addComponentToolSchema = baseAiToolSchema.extend({
  position: z
    .object({
      x: z.number().optional(),
      y: z.number().optional(),
    })
    .optional(),
  size: z
    .object({
      w: z.number().optional().describe("Width in pixels"),
      h: z.number().optional().describe("Height in pixels"),
    })
    .optional(),
  draftId: z
    .string()
    .optional()
    .describe(
      "Optional ID of a draft skeleton placeholder (created by draft_layout) to fulfill in-place. Prefer this over coordinate matching when available."
    ),
});

export const updateComponentCodeToolSchema = z.object({
  rationale: z.string().optional(),
  componentType: z
    .string()
    .optional()
    .describe(
      "A descriptive name for the component type being generated (e.g. 'Card', 'PricingTable', 'HolographicHero'). Used to apply correct sizing rules when fulfilling wireframe nodes."
    ),
  targetId: z
    .string()
    .optional()
    .describe(
      "ID of the wireframe/component to fulfill. MUST be a top-level nodeIntent id. NEVER pass a nestedChildren child id — fulfill its parent instead and embed the child as internal JSX."
    ),
  code: z.string().optional(),
  edits: z
    .array(
      z.object({
        search: z
          .string()
          .describe("The exact code block or text to find and replace"),
        replace: z.string().describe("The new code or text to insert"),
      })
    )
    .optional()
    .describe(
      "Array of surgical edits to apply to the existing component code. Each object specifies a search string and its replacement. Multiple edits can be used to change imports, JSX, hooks, etc. at different parts of the file. Use this for targeted changes. If provided, server applies these edits and ignores the 'code' parameter."
    ),
});

const themeShadowLayerSchema = z.object({
  type: z.enum(["drop", "inset"]),
  offsetX: z.number().describe("px"),
  offsetY: z.number().describe("px"),
  blur: z.number().describe("px, 0 = hard edge"),
  spread: z.number().describe("px"),
  opacity: z.number().describe("0–1"),
  color: z.string().describe('oklch, e.g. "oklch(0 0 0)" or a tinted color'),
});

export const updateThemeToolSchema = z.object({
  rationale: z
    .string()
    .describe(
      "Write this FIRST: the design direction, one short line per dimension — palette, typography, shape (radius, smoothing, border weight), shadow, density — saying how each expresses the request."
    ),
  shadow: z
    .array(themeShadowLayerSchema)
    .max(4)
    .optional()
    .describe(
      "The theme's one shadow, shared by light and dark and applied to every elevated element: 0–4 layers, drop and/or inset. [] = flat, no shadow. Always set it for a new theme; omit it only to keep the current shadow."
    ),
  tokenSources: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      'Only with an attached image: token name → the image element its color came from, e.g. {"primary": "orange CTA button", "card": "sidebar panel"}.'
    ),
  patch: z
    .record(z.string(), z.any())
    .describe(
      "A COMPLETE theme definition containing 'light' and 'dark' sub-objects. You MUST include ALL standard color tokens (background, foreground, primary, etc.) to prevent the old theme from bleeding through."
    ),
});

export type AddComponentToolInput = z.infer<typeof addComponentToolSchema>;
export type UpdateComponentCodeToolInput = z.infer<
  typeof updateComponentCodeToolSchema
> & {
  edits?: Array<{ search: string; replace: string }>;
};
export type UpdateThemeToolInput = z.infer<typeof updateThemeToolSchema>;

export const draftLayoutItemSchema = z.object({
  id: z
    .string()
    .optional()
    .describe(
      "Optional deterministic ID for this placeholder (e.g. 'draft_nav', 'draft_hero'). If provided, the canvas uses it as the node ID so add_component can fulfill it via draftId instead of coordinate matching."
    ),
  componentType: z
    .string()
    .describe(
      "Descriptive name for the component (e.g. 'Sidebar', 'StatCard', 'HeroSection')"
    ),
  x: z.number().describe("Left edge of the component in canvas pixels"),
  y: z.number().describe("Top edge of the component in canvas pixels"),
  w: z.number().describe("Width of the component in pixels"),
  h: z.number().describe("Height of the component in pixels"),
});

export const draftLayoutToolSchema = z.object({
  rationale: z.string().optional(),
  components: z
    .array(draftLayoutItemSchema)
    .min(1)
    .describe(
      "All planned components with their spatial coordinates. Call this ONCE with the full layout plan before writing any code."
    ),
});

export type DraftLayoutToolInput = z.infer<typeof draftLayoutToolSchema>;
