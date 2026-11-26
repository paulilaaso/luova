/**
 * Label-left rows used by the Edit mode cards. Every card shares one label
 * width (fits "Smoothing", the longest label) so controls start on the same
 * line down the panel; it scales with Master Font Scale like the labels do.
 */
export const ROW_GRID =
  "grid grid-cols-[calc(3.875rem*var(--font-scale,1))_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 pt-1";

/** One row of a ROW_GRID: a label (same weight and color as the config
 * panel labels), then its control(s). */
export function PanelRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <span className="text-xs font-medium text-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </>
  );
}
