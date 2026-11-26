import { create } from "zustand";
import type {
  TypographyProperty,
  TypographyValues,
} from "@/utils/text-typography";

/** Block-level structure the sidebar can switch a text node between. */
export type TextBlockType = "paragraph" | "h1" | "h2" | "h3";
export type TextAlignment = "left" | "center" | "right" | "justify";

export interface TextFormatSession {
  nodeId: string;
  values: TypographyValues;
  apply: (
    property: TypographyProperty,
    value: string | number,
    tokenKey?: string
  ) => void;
  preview: (property: TypographyProperty, value: string | number) => void;
  clear: () => void;
}

/**
 * Structural editing bridge for the currently-edited text node. Unlike
 * {@link TextFormatSession} (which only exists while a text range is selected),
 * the controller is available the whole time a node is open in the editor, so
 * the sidebar can expose block/inline formatting with a bare caret.
 */
export interface TextFormatController {
  nodeId: string;
  block: TextBlockType;
  /** Empty inherits the component alignment; null means selected blocks differ. */
  alignment: TextAlignment | "" | null;
  formatBlock: (type: TextBlockType) => void;
  formatAlignment: (alignment: TextAlignment) => void;
  /** Write pending text edits before another command rewrites the node code. */
  flush: () => void;
  /** Remove a block-level property's stale run overrides in the live editor. */
  clearProperty: (property: TypographyProperty) => void;
  /** Reset the node to plain paragraphs, stripping all run/block formatting. */
  resetText: () => void;
}

// Ephemeral editor bridge. Never persisted with project data or history.
export const useTextFormatStore = create<{
  session: TextFormatSession | null;
  controller: TextFormatController | null;
}>(() => ({ session: null, controller: null }));
