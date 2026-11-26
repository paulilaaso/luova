"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/luova-utils";

export type BoxSide = "top" | "right" | "bottom" | "left";
export type BoxLayer = "margin" | "padding";
export type BoxValues = Record<BoxSide, number>;

export interface BoxLayerState {
  values: BoxValues;
  /** Sides with a value explicitly set on the element (full contrast). */
  set: Record<BoxSide, boolean>;
  /** Sides whose margin is `auto` (shown as text, not the resolved px). */
  auto?: Partial<Record<BoxSide, boolean>>;
}

type SideRef = { layer: BoxLayer; side: BoxSide };

const SIDES: BoxSide[] = ["top", "right", "bottom", "left"];
const OPPOSITE: Record<BoxSide, BoxSide> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};

const HEIGHT = 124;
// Band thickness of each ring; vertical bands are wider so left/right values
// have room.
const RING = {
  margin: { x: 44, y: 28, radius: 6 },
  padding: { x: 40, y: 24, radius: 4 },
} as const;
const CONTENT_RADIUS = 3;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const inset = (r: Rect, dx: number, dy: number): Rect => ({
  x: r.x + dx,
  y: r.y + dy,
  w: r.w - 2 * dx,
  h: r.h - 2 * dy,
});

/** Trapezoid between a ring's outer and inner rectangles. Its square outer
 * corners are trimmed by the ring's rounded clip path. */
function bandPath(side: BoxSide, o: Rect, i: Rect): string {
  const ox2 = o.x + o.w;
  const oy2 = o.y + o.h;
  const ix2 = i.x + i.w;
  const iy2 = i.y + i.h;
  const pts: Record<BoxSide, number[][]> = {
    top: [
      [o.x, o.y],
      [ox2, o.y],
      [ix2, i.y],
      [i.x, i.y],
    ],
    right: [
      [ox2, o.y],
      [ox2, oy2],
      [ix2, iy2],
      [ix2, i.y],
    ],
    bottom: [
      [i.x, iy2],
      [ix2, iy2],
      [ox2, oy2],
      [o.x, oy2],
    ],
    left: [
      [o.x, o.y],
      [i.x, i.y],
      [i.x, iy2],
      [o.x, oy2],
    ],
  };
  return `M${pts[side].map(([x, y]) => `${x} ${y}`).join(" L")} Z`;
}

/** Centre of a side's band, where its value sits. */
function bandCenter(side: BoxSide, o: Rect, i: Rect): { x: number; y: number } {
  const cx = o.x + o.w / 2;
  const cy = o.y + o.h / 2;
  switch (side) {
    case "top":
      return { x: cx, y: (o.y + i.y) / 2 };
    case "bottom":
      return { x: cx, y: (o.y + o.h + i.y + i.h) / 2 };
    case "left":
      return { x: (o.x + i.x) / 2, y: cy };
    case "right":
      return { x: (o.x + o.w + i.x + i.w) / 2, y: cy };
  }
}

/** Width of the type-in field for its current text. */
const fieldWidth = (text: string) =>
  `calc(${Math.max(text.length, 1)}ch + 4px)`;

interface DragState extends SideRef {
  x: number;
  y: number;
  start: BoxValues;
  moved: boolean;
  value: number;
  sides: BoxSide[];
}

/**
 * Margin/padding box model. Drag a value to scrub it (right/up increases),
 * Alt also moves the opposite side, Shift moves all four; click to type.
 * Dragged values pass through `snap` (the spacing scale, or whole pixels),
 * so the preview matches what's saved.
 *
 * Drawn as one SVG sized to its container so the rounded rings, trapezoids
 * and diagonals line up exactly. Values and the type-in field sit in an
 * unclipped HTML layer above it.
 */
export function SpacingBox({
  margin,
  padding,
  snap,
  onPreview,
  onCommit,
}: {
  margin: BoxLayerState;
  padding: BoxLayerState;
  snap: (px: number) => number;
  onPreview: (layer: BoxLayer, sides: BoxSide[], value: number) => void;
  onCommit: (layer: BoxLayer, sides: BoxSide[], value: number) => void;
}) {
  const layers = { margin, padding };
  const clipId = useId().replace(/:/g, "");
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const dragRef = useRef<DragState | null>(null);
  const cancelEditRef = useRef(false);
  const [draft, setDraft] = useState<{
    layer: BoxLayer;
    sides: BoxSide[];
    value: number;
  } | null>(null);
  const [active, setActive] = useState<SideRef | null>(null);
  const [hovered, setHovered] = useState<SideRef | null>(null);
  const [editing, setEditing] = useState<SideRef | null>(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Once the element re-measures with the new value, drop the local draft.
  const valuesKey = [margin.values, padding.values]
    .map((v) => SIDES.map((s) => v[s]).join(","))
    .join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on value change only
  useEffect(() => {
    if (!dragRef.current) setDraft(null);
  }, [valuesKey]);

  const sidesFor = (
    side: BoxSide,
    e: { altKey: boolean; shiftKey: boolean }
  ) => (e.shiftKey ? SIDES : e.altKey ? [side, OPPOSITE[side]] : [side]);

  const handlePointerDown = (
    e: React.PointerEvent<SVGPathElement>,
    layer: BoxLayer,
    side: BoxSide
  ) => {
    if (e.button !== 0 || editing) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const start = { ...layers[layer].values };
    dragRef.current = {
      layer,
      side,
      x: e.clientX,
      y: e.clientY,
      start,
      moved: false,
      value: start[side],
      sides: [side],
    };
  };

  const handlePointerMove = (e: React.PointerEvent<SVGPathElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < 3) return;
      drag.moved = true;
      setActive({ layer: drag.layer, side: drag.side });
      document.body.style.cursor =
        drag.side === "top" || drag.side === "bottom"
          ? "ns-resize"
          : "ew-resize";
    }
    const value = Math.max(0, snap(drag.start[drag.side] + dx - dy));
    const sides = sidesFor(drag.side, e);
    if (value === drag.value && sides.length === drag.sides.length) return;
    // Sides dropped by releasing a modifier go back to where they started.
    for (const side of drag.sides) {
      if (!sides.includes(side))
        onPreview(drag.layer, [side], drag.start[side]);
    }
    drag.value = value;
    drag.sides = sides;
    setDraft({ layer: drag.layer, sides, value });
    onPreview(drag.layer, sides, value);
  };

  const handlePointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    setActive(null);
    document.body.style.removeProperty("cursor");
    if (!drag) return;
    if (drag.moved) onCommit(drag.layer, drag.sides, drag.value);
    else setEditing({ layer: drag.layer, side: drag.side });
  };

  const commitTyped = (layer: BoxLayer, side: BoxSide, raw: string) => {
    setEditing(null);
    const parsed = Number.parseFloat(raw.replace(",", "."));
    if (!Number.isFinite(parsed)) return;
    // Typed values are kept exactly (3 stays 3); only dragging snaps.
    const value = Math.max(0, Math.round(parsed));
    if (value === layers[layer].values[side] && !layers[layer].auto?.[side])
      return;
    setDraft({ layer, sides: [side], value });
    onCommit(layer, [side], value);
  };

  const isOn = (state: SideRef | null, layer: BoxLayer, side: BoxSide) =>
    state?.layer === layer && state.side === side;

  // ── Geometry (0.5 offsets keep 1px strokes on the pixel grid) ──────────
  const outer: Rect = {
    x: 0.5,
    y: 0.5,
    w: Math.max(width - 1, 0),
    h: HEIGHT - 1,
  };
  const paddingRect = inset(outer, RING.margin.x, RING.margin.y);
  const contentRect = inset(paddingRect, RING.padding.x, RING.padding.y);
  const rings: Record<BoxLayer, { outer: Rect; inner: Rect }> = {
    margin: { outer, inner: paddingRect },
    padding: { outer: paddingRect, inner: contentRect },
  };

  const roundedRect = (r: Rect, radius: number, className?: string) => (
    <rect
      x={r.x}
      y={r.y}
      width={Math.max(r.w, 0)}
      height={Math.max(r.h, 0)}
      rx={radius}
      className={className}
    />
  );

  const renderBands = (layer: BoxLayer) => {
    const { outer: o, inner: i } = rings[layer];
    return SIDES.map((side) => {
      const vertical = side === "top" || side === "bottom";
      const name = `${layer === "margin" ? "Margin" : "Padding"} ${side}`;
      const value = layers[layer].auto?.[side]
        ? "auto"
        : `${layers[layer].values[side]}px`;
      const fill = isOn(active, layer, side)
        ? "fill-foreground/[0.08]"
        : isOn(hovered, layer, side)
          ? "fill-foreground/[0.05]"
          : vertical
            ? "fill-foreground/[0.02]"
            : "fill-transparent";
      return (
        // biome-ignore lint/a11y/useSemanticElements: an SVG trapezoid can't be a native button
        <path
          key={side}
          d={bandPath(side, o, i)}
          role="button"
          tabIndex={0}
          aria-label={`${name}: ${value}`}
          className={cn(
            "outline-none transition-[fill] duration-150 ease-out focus-visible:fill-foreground/[0.06]",
            vertical ? "cursor-ns-resize" : "cursor-ew-resize",
            fill
          )}
          style={{ touchAction: "none" }}
          onPointerEnter={() => setHovered({ layer, side })}
          onPointerLeave={() => setHovered(null)}
          onPointerDown={(e) => handlePointerDown(e, layer, side)}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setEditing({ layer, side });
            }
          }}
        >
          <title>{`${name} · drag to adjust (Alt: opposite side, Shift: all sides) · click to type`}</title>
        </path>
      );
    });
  };

  /** Hairlines from each outer corner to the matching inner corner. */
  const renderDiagonals = (layer: BoxLayer) => {
    const { outer: o, inner: i } = rings[layer];
    const lines = [
      [o.x, o.y, i.x, i.y],
      [o.x + o.w, o.y, i.x + i.w, i.y],
      [o.x + o.w, o.y + o.h, i.x + i.w, i.y + i.h],
      [o.x, o.y + o.h, i.x, i.y + i.h],
    ];
    return lines.map(([x1, y1, x2, y2], index) => (
      <line
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed four corners
        key={index}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        className="pointer-events-none stroke-border"
        strokeWidth={1}
      />
    ));
  };

  const renderValues = (layer: BoxLayer) => {
    const { outer: o, inner: i } = rings[layer];
    return SIDES.map((side) => {
      const { x, y } = bandCenter(side, o, i);
      const isDraft = draft?.layer === layer && draft.sides.includes(side);
      const value = isDraft ? draft.value : layers[layer].values[side];
      const isAuto = !isDraft && layers[layer].auto?.[side];
      const isSet = isDraft || layers[layer].set[side];
      const name = `${layer === "margin" ? "Margin" : "Padding"} ${side}`;
      return (
        <div
          key={side}
          className="absolute flex h-5 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
          style={{ left: x, top: y }}
        >
          {isOn(editing, layer, side) ? (
            <input
              ref={(el) => {
                if (el && document.activeElement !== el) {
                  // Focus without scrolling the panel.
                  el.focus({ preventScroll: true });
                  el.select();
                }
              }}
              aria-label={name}
              inputMode="numeric"
              defaultValue={isAuto ? "" : String(value)}
              // Hug the digits: as wide as the text plus a hair of room.
              style={{ width: fieldWidth(isAuto ? "" : String(value)) }}
              onInput={(e) => {
                e.currentTarget.style.width = fieldWidth(e.currentTarget.value);
              }}
              className="pointer-events-auto h-4 rounded-[3px] bg-background px-0 text-center text-xs leading-none tabular-nums text-foreground shadow-[0_0_0_1px_var(--ring)] outline-none"
              onKeyDown={(e) => {
                e.stopPropagation();
                // Both paths end in blur, the single place that commits.
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  cancelEditRef.current = true;
                  e.currentTarget.blur();
                }
              }}
              onBlur={(e) => {
                if (cancelEditRef.current) {
                  cancelEditRef.current = false;
                  setEditing(null);
                  return;
                }
                commitTyped(layer, side, e.currentTarget.value);
              }}
            />
          ) : (
            <span
              className={cn(
                "text-xs tabular-nums transition-colors duration-150",
                isSet
                  ? "font-medium text-foreground"
                  : "text-muted-foreground/70"
              )}
            >
              {isAuto ? "auto" : value}
            </span>
          )}
        </div>
      );
    });
  };

  const labelClass =
    "absolute text-2xs font-medium uppercase tracking-wide text-muted-foreground/80";

  return (
    <div
      ref={containerRef}
      className="relative w-full select-none"
      style={{ height: HEIGHT }}
    >
      {width > 0 && (
        <>
          <svg
            width={width}
            height={HEIGHT}
            className="absolute inset-0"
            aria-label="Margin and padding"
          >
            <defs>
              <clipPath id={`${clipId}-margin`}>
                {roundedRect(outer, RING.margin.radius)}
              </clipPath>
              <clipPath id={`${clipId}-padding`}>
                {roundedRect(paddingRect, RING.padding.radius)}
              </clipPath>
            </defs>

            {roundedRect(outer, RING.margin.radius, "fill-muted/50")}
            <g clipPath={`url(#${clipId}-margin)`}>
              {renderBands("margin")}
              {renderDiagonals("margin")}
            </g>

            {roundedRect(paddingRect, RING.padding.radius, "fill-muted")}
            <g clipPath={`url(#${clipId}-padding)`}>
              {renderBands("padding")}
              {renderDiagonals("padding")}
            </g>

            {roundedRect(
              contentRect,
              CONTENT_RADIUS,
              // The element itself takes the card's color, so it matches the
              // card around the box in both light and dark mode.
              "pointer-events-none fill-card stroke-border"
            )}
            {/* Ring outlines last so the diagonals end exactly on them */}
            {roundedRect(
              paddingRect,
              RING.padding.radius,
              "pointer-events-none fill-none stroke-border"
            )}
            {roundedRect(
              outer,
              RING.margin.radius,
              "pointer-events-none fill-none stroke-border"
            )}
          </svg>

          <div className="pointer-events-none absolute inset-0">
            <span className={labelClass} style={{ left: 8, top: 5 }}>
              Margin
            </span>
            <span
              className={labelClass}
              style={{ left: paddingRect.x + 6, top: paddingRect.y + 3 }}
            >
              Padding
            </span>
            {renderValues("margin")}
            {renderValues("padding")}
          </div>
        </>
      )}
    </div>
  );
}
