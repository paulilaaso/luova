import { normalizeTailwindCssFunctions } from "./tailwind-css-normalize";

const STYLE_ID = "luova-component-styles";

class ComponentStyleManager {
  private styles: Map<string, string> = new Map();
  private styleElement: HTMLStyleElement | null = null;
  private updateScheduled = false;

  private getOrCreateStyleElement(): HTMLStyleElement {
    if (this.styleElement?.ownerDocument) {
      return this.styleElement;
    }

    let element = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!element) {
      element = document.createElement("style");
      element.id = STYLE_ID;

      // Insert BEFORE any existing stylesheets so that globals.css (which contains
      // robustly sorted responsive variants) takes precedence for cascade ties.
      // This prevents injected base utilities like .hidden from clobbering global .md:flex
      const firstLink = document.head.querySelector(
        "link[rel='stylesheet'], style"
      );
      if (firstLink) {
        document.head.insertBefore(element, firstLink);
      } else {
        document.head.appendChild(element);
      }
    }
    this.styleElement = element;
    return element;
  }

  private scheduleUpdate(): void {
    if (this.updateScheduled) return;
    this.updateScheduled = true;
    Promise.resolve().then(() => {
      this.updateScheduled = false;
      this.renderStyles();
    });
  }

  private renderStyles(): void {
    const element = this.getOrCreateStyleElement();
    const css = this.buildCss();
    element.textContent = css;
  }

  private buildCss(): string {
    const lines: string[] = [];
    for (const [, css] of this.styles) {
      if (css) lines.push(css);
    }
    return normalizeTailwindCssFunctions(lines.join("\n"));
  }

  registerStyle(nodeId: string, css: string): void {
    if (!css) {
      this.unregisterStyle(nodeId);
      return;
    }
    const existing = this.styles.get(nodeId);
    if (existing === css) return;
    this.styles.set(nodeId, css);
    this.scheduleUpdate();
  }

  unregisterStyle(nodeId: string): void {
    if (!this.styles.has(nodeId)) return;
    this.styles.delete(nodeId);
    this.scheduleUpdate();
  }

  getStyle(nodeId: string): string | undefined {
    return this.styles.get(nodeId);
  }

  clearAll(): void {
    this.styles.clear();
    this.scheduleUpdate();
  }

  hasStyle(nodeId: string): boolean {
    return this.styles.has(nodeId);
  }
}

export const componentStyleManager = new ComponentStyleManager();

/**
 * Render-signal registry.
 *
 * NativeRenderer calls `notifyComponentRendered(nodeId)` after a new component
 * version has painted. CapturedElementPanel subscribes via `onComponentRendered`
 * to know the exact moment it's safe to drop the live CSS override without a flash.
 */
type RenderListener = (nodeId: string) => void;
const renderListeners = new Set<RenderListener>();

export function onComponentRendered(listener: RenderListener): () => void {
  renderListeners.add(listener);
  return () => renderListeners.delete(listener);
}

export function notifyComponentRendered(nodeId: string): void {
  for (const listener of renderListeners) {
    listener(nodeId);
  }
}
