import { loadTemplate } from "@/lib/ai/load-template";
import type { AiProvider } from "@/lib/ai/providers";
import { getMinifiedTokenAtlas } from "@/lib/ai/theme-atlas";
import type { AiContextSnapshot, AiMode } from "@/types/ai";

export { loadTemplate } from "@/lib/ai/load-template";

// ---------------------------------------------------------------------------
// Domain-aware layout rules — injected into create.md's {{domainRules}}
// placeholder only when the user's prompt matches. This keeps the static
// prompt small for local models while preserving pixel-perfect guidance
// when users explicitly ask for decks, sites, apps, or galleries.
// ---------------------------------------------------------------------------

export const DOMAIN_SLIDE_RULES = `### Slide Deck Layout
- One static 16:9 frame per slide: w:1280 h:720, all at y:0 with a 50px gap → x:0, 1330, 2660, 3990…
- No next/previous buttons or slide-index state unless a slide player is explicitly requested.`;

export const DOMAIN_WEBSITE_RULES = `### Website Layout
- One node per section (Hero, Features, Pricing, Testimonials, Footer), each the full canvas width ({{canvasWidth}}px) at x:0.
- Stack vertically with 40px gaps: y = previous y + previous h + 40 (Hero y:0 h:600 → Features y:640).`;

export const DOMAIN_APP_RULES = `### Dashboard / App Layout
- One node per module: Sidebar (left edge, full height, e.g. w:240), Header (top, beside the sidebar, e.g. h:80), then stat-card grid, charts and tables in the remaining area.
- Modules may be interactive (state, effects, handlers).`;

export const DOMAIN_LIBRARY_RULES = `### Component Library Layout
- Every item is its own node — never one wrapper (ButtonLibrary, ComponentGallery) rendering many.
- Grid with 40px gaps, e.g. 200x48 items → x:0/240/480/720, rows y:0/88/176.`;

export const SINGLE_COMPONENT_RULES = `### Single Component
Call \`add_component\` EXACTLY ONCE with complete TSX (under ~150 lines), then end your turn with no follow-up text.
- Do NOT call \`draft_layout\`.
- Place it near the top-center of the {{canvasWidth}}x{{canvasHeight}}px canvas (e.g. x:400, y:80) with a content-sized frame (e.g. w:400 h:520 for cards and forms).`;

/**
 * Heuristic fast-path detector: true when the prompt looks like ONE
 * standalone component (button, login card, modal, navbar, pricing card).
 * Anything matching a multi-component domain (deck, gallery, site, app) or
 * carrying explicit multi signals (plurals, counts, grids) stays on the
 * two-phase pipeline. Conservative by design — when in doubt it returns
 * false and the request takes the full multi-component path.
 */
export function isSingleComponentRequest(prompt: string): boolean {
  if (!prompt.trim()) return false;
  const multi = detectCreateDomains(prompt);
  if (multi.isDeck || multi.isLibrary || multi.isWebsite || multi.isApp) {
    return false;
  }
  if (
    /\b(components|sections|slides|variants|multiple|several|set of|collection|grid|side-by-side|two|three|four|five|six|seven|eight|\d+)\b/i.test(
      prompt
    )
  ) {
    return false;
  }
  return true;
}

export function detectCreateDomains(prompt: string): {
  isDeck: boolean;
  isLibrary: boolean;
  isWebsite: boolean;
  isApp: boolean;
} {
  return {
    isDeck: /slide|deck|presentation|keynote|pitch/i.test(prompt),
    isLibrary: /librar|galler|design system|component collection/i.test(prompt),
    isWebsite: /website|landing|homepage|portfolio site|marketing page/i.test(
      prompt
    ),
    isApp: /dashboard|admin panel|analytics|web app|saas|platform/i.test(
      prompt
    ),
  };
}

export function buildDomainRules(
  prompt: string,
  canvasWidth: number,
  singleComponent = false,
  canvasHeight: number = canvasWidth
): string {
  if (singleComponent) {
    // Placeholders are interpolated here (not by loadTemplate) because the
    // template engine only replaces tokens present before value insertion.
    return SINGLE_COMPONENT_RULES.replace(
      "{{canvasWidth}}",
      String(canvasWidth)
    ).replace("{{canvasHeight}}", String(canvasHeight));
  }
  const { isDeck, isLibrary, isWebsite, isApp } = detectCreateDomains(prompt);
  const sections: string[] = [];
  if (isDeck) sections.push(DOMAIN_SLIDE_RULES);
  if (isWebsite)
    sections.push(
      DOMAIN_WEBSITE_RULES.replace("{{canvasWidth}}", String(canvasWidth))
    );
  if (isApp) sections.push(DOMAIN_APP_RULES);
  if (isLibrary) sections.push(DOMAIN_LIBRARY_RULES);
  // Generic multi-component requests need nothing beyond create.md itself.
  return sections.length > 0 ? `\n${sections.join("\n\n")}` : "";
}

function topLevelWireframeIds(context: AiContextSnapshot): string[] {
  return (context.nodeIntents ?? [])
    .filter((n) => n.kind === "wireframe")
    .map((n) => n.id);
}

function wireframeFulfillmentInstruction(
  context: AiContextSnapshot,
  ids: string[],
  canvasWidth: number,
  canvasHeight: number
): string {
  const lines = [
    `Mode: CREATE (wireframe fulfillment). Canvas: ${canvasWidth}x${canvasHeight}px.`,
    `Wireframe ids to fulfill: ${ids.join(", ")}.` +
      (ids.length > 1
        ? ` Emit one update_component_code per id and do NOT stop until every id is fulfilled.`
        : ""),
  ];
  // A prompt alongside wireframes refines the fulfillment — without this the
  // model treats it as a fresh creation request and the wireframes lose.
  if (context.prompt.trim()) {
    lines.push(
      "The user prompt describes content and style: apply it INSIDE the wireframe fulfillment, not as separate new components. Structure (layout, proportions, sequence, anchors) comes from the wireframes — on conflict the drawn layout wins."
    );
  }
  return [lines.join("\n"), loadTemplate("wireframe-fill").trimEnd()].join(
    "\n\n"
  );
}

function modeInstruction(mode: AiMode, context: AiContextSnapshot): string {
  const canvasWidth = context.canvasBounds?.width ?? 1200;
  const canvasHeight = context.canvasBounds?.height ?? 800;

  switch (mode) {
    case "create": {
      // Wireframe fulfillment replaces the drafting pipeline entirely: the
      // drawn wireframes are the layout, so none of create.md applies.
      const wireframeIds = topLevelWireframeIds(context);
      if (wireframeIds.length > 0) {
        return wireframeFulfillmentInstruction(
          context,
          wireframeIds,
          canvasWidth,
          canvasHeight
        );
      }
      // Fast path: single-component prompts get a one-call directive instead
      // of the two-phase pipeline docs.
      const singleComponent = isSingleComponentRequest(context.prompt);
      const domainRules = buildDomainRules(
        context.prompt,
        canvasWidth,
        singleComponent,
        canvasHeight
      );
      if (singleComponent) return `Mode: CREATE.\n${domainRules.trim()}`;
      return loadTemplate("create", {
        canvasWidth: String(canvasWidth),
        canvasHeight: String(canvasHeight),
        domainRules,
      });
    }

    case "edit": {
      return loadTemplate("edit", {
        selectedId: context.selectedIds[0] ?? "unknown",
      });
    }

    case "bake":
      return loadTemplate("bake", {
        selectedIds: context.selectedIds.join(", "),
        firstSelectedId: context.selectedIds[0] ?? "the first selected id",
      });

    case "theme":
      return loadTemplate("theme", {
        tokenAtlas: getMinifiedTokenAtlas(),
        lightStyles: JSON.stringify(
          withoutShadowTokens(context.themeState?.styles.light),
          null,
          2
        ),
        darkStyles: JSON.stringify(
          withoutShadowTokens(context.themeState?.styles.dark),
          null,
          2
        ),
        currentShadow: JSON.stringify(
          currentShadowLayers(context.themeState?.styles.light)
        ),
      });

    default:
      return "Mode: CREATE.";
  }
}

function buildSelectionContext(context: AiContextSnapshot): string {
  const { mode } = context;

  // Theme mode: only mode + activeTab (theme state is in the mode instruction)
  if (mode === "theme") {
    return JSON.stringify({ mode, activeTab: context.activeTab }, null, 2);
  }

  // Create mode: only mode, canvas bounds, and wireframe intents
  if (mode === "create") {
    const payload: Record<string, unknown> = {
      mode,
      activeTab: context.activeTab,
    };
    if (context.canvasBounds) payload.canvasBounds = context.canvasBounds;
    if (context.nodeIntents && context.nodeIntents.length > 0) {
      payload.nodeIntents = context.nodeIntents;
    }
    return JSON.stringify(payload, null, 2);
  }

  // Edit / Bake mode: selected nodes + intents only
  const selectedNodesSummary = (context.selectedNodes ?? []).map((node) => ({
    id: node.id,
    type: node.type,
    x: node.props.x,
    y: node.props.y,
    w: node.props.w,
    h: node.props.h,
    props: node.props,
    code: node.code,
  }));

  const payload: Record<string, unknown> = {
    mode,
    activeTab: context.activeTab,
    selectedIds: context.selectedIds,
  };

  if (selectedNodesSummary.length > 0) {
    payload.selectedNodes = selectedNodesSummary;
  }

  if (context.canvasBounds) {
    payload.canvasBounds = context.canvasBounds;
  }

  if (context.nodeIntents && context.nodeIntents.length > 0) {
    // Captured elements refer to source components already included above.
    // Keep their targeting metadata, but send each component's code only once.
    payload.nodeIntents = context.nodeIntents.map((intent) => {
      const source = context.selectedNodes?.find(
        (node) => node.id === intent.sourceComponentId
      );
      if (source && source.code === intent.sourceCode) {
        const { sourceCode: _, ...metadata } = intent;
        return metadata;
      }
      return intent;
    });
  }

  return JSON.stringify(payload, null, 2);
}

/**
 * Claude models get tool_choice "auto" (current ones reject a forced tool
 * with a 400), so the prompt carries the "always call the tool" rule instead.
 */
const ANTHROPIC_TOOL_USE_RULE =
  "Respond ONLY by calling the provided tool(s). Never answer with plain text, markdown or code blocks — output that is not a tool call is discarded.";

export function createInstructions(
  context: AiContextSnapshot,
  userSystemPrompt?: string,
  provider?: AiProvider
): string {
  const instructions = buildModeInstructions(context, userSystemPrompt);
  return provider === "anthropic"
    ? `${instructions}\n\n${ANTHROPIC_TOOL_USE_RULE}`
    : instructions;
}

function buildModeInstructions(
  context: AiContextSnapshot,
  userSystemPrompt?: string
): string {
  if (context.mode === "recreate") {
    const tokens = context.themeState?.styles[context.themeState.currentMode];
    const pick = (font: boolean) =>
      tokens &&
      Object.fromEntries(
        Object.entries(tokens).filter(
          ([key]) => key.startsWith("font-") === font
        )
      );
    return [
      loadTemplate("recreate"),
      "Current builder context:",
      JSON.stringify({
        mode: context.mode,
        sourceImage: context.sourceImage,
        themeTokenSources: context.themeTokenSources,
        currentTheme: context.themeState
          ? {
              mode: context.themeState.currentMode,
              colors: pick(false),
              fonts: pick(true),
            }
          : undefined,
      }),
    ].join("\n\n");
  }

  // Theme mode produces global CSS/OKLCH palettes — component design rules,
  // Radix catalogs, and canvas coordinate rules only waste context and dilute
  // color focus. Load just the theme instruction (+ token atlas inside it).
  if (context.mode === "theme") {
    const modeText = modeInstruction(context.mode, context);
    const dynamicContext = [
      "",
      "Current builder context:",
      buildSelectionContext(context),
      "",
      modeText,
    ].join("\n");
    return dynamicContext;
  }

  const staticContext = loadTemplate("base").trimEnd();

  const modeText = modeInstruction(context.mode, context);

  // Wireframe reading rules ship only when wireframes are actually in play
  // (create fulfillment, bake of selected wireframes, or wireframes drawn
  // inside an edited component).
  const hasWireframes = topLevelWireframeIds(context).length > 0;
  const editWireframeNote =
    context.mode === "edit"
      ? "Wireframes in nodeIntents were drawn inside the target component: build them into it with your edits. Never target a wireframe id.\n\n"
      : "";
  const wireframeGeometry = hasWireframes
    ? `\n\n${editWireframeNote}${loadTemplate("wireframe-read").trimEnd()}`
    : "";

  // DYNAMIC BLOCK — changes with user selections, mode, theme state
  const dynamicContext = [
    "",
    "Current builder context:",
    buildSelectionContext(context),
    "",
    modeText + wireframeGeometry,
  ].join("\n");

  const systemPromptBlock =
    context.mode === "create" && userSystemPrompt?.trim()
      ? `\n\nAdditional instructions from the user:\n${userSystemPrompt.trim()}`
      : "";

  return staticContext + dynamicContext + systemPromptBlock;
}

/** Theme styles without shadow tokens; the shadow is shown as layers instead. */
function withoutShadowTokens(
  styles: Record<string, unknown> | undefined
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(styles ?? {}).filter(
      ([key]) => key !== "shadow-groups" && !key.endsWith("-shadow")
    )
  );
}

/** The default shadow group's layers, in the `update_theme` `shadow` shape. */
function currentShadowLayers(styles: Record<string, unknown> | undefined) {
  try {
    const groups = JSON.parse(String(styles?.["shadow-groups"] ?? "[]")) as {
      isDefault?: boolean;
      visible?: boolean;
      layers?: Record<string, string | boolean>[];
    }[];
    const group = groups.find((g) => g.isDefault) ?? groups[0];
    if (!group || group.visible === false) return [];
    const px = (v: unknown) => Number.parseFloat(String(v)) || 0;
    return (group.layers ?? [])
      .filter((layer) => layer.visible !== false)
      .map((layer) => ({
        type: layer.type,
        offsetX: px(layer.offsetX),
        offsetY: px(layer.offsetY),
        blur: px(layer.blur),
        spread: px(layer.spread),
        opacity: px(layer.opacity),
        color: layer.color,
      }));
  } catch {
    return [];
  }
}
