"use client";

import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Heading1,
  Heading2,
  Heading3,
  type LucideIcon,
  Pilcrow,
} from "lucide-react";
import { cn, stopShortcutsExceptUndo } from "@/lib/luova-utils";
import { useProjectStore } from "@/stores/project-store";
import {
  type TextAlignment,
  type TextBlockType,
  useTextFormatStore,
} from "@/stores/text-format-store";
import { extractInnerJsx, wrapInnerJsx } from "@/utils/html-to-jsx";
import { getInnerJsxBlockType, setInnerJsxBlockType } from "@/utils/rich-text";
import type {
  TypographyProperty,
  TypographyValues,
} from "@/utils/text-typography";
import { FormatButton } from "./FormatButton";
import { InlineFormatToggles } from "./InlineFormatToggles";
import { TOOLBAR_BUTTON, TOOLBAR_TRACK } from "./ui/toolbar";

const BLOCKS: Array<{ type: TextBlockType; label: string; Icon: LucideIcon }> =
  [
    { type: "paragraph", label: "Paragraph", Icon: Pilcrow },
    { type: "h1", label: "Heading 1", Icon: Heading1 },
    { type: "h2", label: "Heading 2", Icon: Heading2 },
    { type: "h3", label: "Heading 3", Icon: Heading3 },
  ];
export const ALIGNMENTS: Array<{
  alignment: TextAlignment;
  label: string;
  Icon: LucideIcon;
}> = [
  { alignment: "left", label: "Align left", Icon: AlignLeft },
  { alignment: "center", label: "Align center", Icon: AlignCenter },
  { alignment: "right", label: "Align right", Icon: AlignRight },
  { alignment: "justify", label: "Justify", Icon: AlignJustify },
];

/**
 * The formatting toolbar for a text node. While the node is open in the
 * Lexical editor, block buttons act on the selected blocks; otherwise they
 * switch every block of the element, like the other controls do.
 */
export function TextBlockFormatControls({
  nodeId,
  values,
  onChange,
  alignment,
  onAlign,
}: {
  nodeId: string;
  values: TypographyValues;
  onChange: (property: TypographyProperty, value: string | number) => void;
  alignment: TextAlignment | null;
  onAlign: (alignment: TextAlignment) => void;
}) {
  const controller = useTextFormatStore((s) => s.controller);
  const active = controller?.nodeId === nodeId;
  const code = useProjectStore((s) => s.nodes[nodeId]?.code);
  const updateComponentCode = useProjectStore((s) => s.updateComponentCode);
  // While editing, the editor knows the caret's block; otherwise show the
  // type shared by the whole element (none when its blocks differ).
  const block = active
    ? controller.block
    : code
      ? getInnerJsxBlockType(extractInnerJsx(code))
      : null;

  const formatBlock = (type: TextBlockType) => {
    if (active) {
      controller.formatBlock(type);
      return;
    }
    // No editor open: apply the block type to the whole element.
    if (!code) return;
    const updated = wrapInnerJsx(
      code,
      setInnerJsxBlockType(extractInnerJsx(code), type)
    );
    if (updated !== code) updateComponentCode(nodeId, updated);
  };

  return (
    <fieldset
      aria-label="Text formatting"
      data-text-format-controls="true"
      className="min-w-0 w-full"
      onKeyDown={stopShortcutsExceptUndo}
    >
      <div className="space-y-1.5">
        <div className={cn(TOOLBAR_TRACK, "w-full")}>
          {BLOCKS.map(({ type, label, Icon }) => (
            <FormatButton
              key={type}
              label={label}
              active={block === type}
              disabled={false}
              className={TOOLBAR_BUTTON}
              onClick={() => formatBlock(type)}
            >
              <Icon className="size-3.5" />
            </FormatButton>
          ))}
        </div>
        <div className="flex gap-1.5">
          <div className={TOOLBAR_TRACK}>
            <InlineFormatToggles
              values={values}
              onChange={onChange}
              buttonClassName={TOOLBAR_BUTTON}
            />
          </div>
          <div className={cn(TOOLBAR_TRACK, "flex-[4]")}>
            {ALIGNMENTS.map(({ alignment: value, label, Icon }) => (
              <FormatButton
                key={value}
                label={label}
                active={alignment === value}
                disabled={false}
                className={TOOLBAR_BUTTON}
                onClick={() => onAlign(value)}
              >
                <Icon className="size-3.5" />
              </FormatButton>
            ))}
          </div>
        </div>
      </div>
    </fieldset>
  );
}
