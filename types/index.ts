export type ColorPickerProps = {
  /**
   * The current color value.
   */
  color: string | undefined;
  /**
   * Callback invoked whenever the color value changes.
   */
  onChange: (color: string, tokenKey?: string) => void;
  /**
   * Callback invoked immediately on every change (for real-time visual updates).
   * Use this for the theme mutation engine to avoid full re-renders.
   */
  onChangeImmediate?: (color: string, tokenKey?: string) => void;
  /**
   * Callback invoked once when a drag gesture ends (pointerup).
   * Use this to commit the final value to the store without writing on every frame.
   */
  onChangeCommit?: (color: string, tokenKey?: string) => void;
  /**
   * Human-readable label for the control.
   */
  label: string;
  /**
   * (Optional) Identifier that maps this color picker to a theme style key.
   */
  name?: string;
  /**
   * (Optional) Explicitly enable or disable gradient mode for this picker.
   * If not provided, gradient support is auto-detected from the `name` prop
   * (only `-bg` and `-c` suffixed component tokens support gradients).
   */
  enableGradient?: boolean;
  /**
   * (Optional) Whether to show the opacity slider. Defaults to true.
   * Set to false for border colors to remove the opacity option.
   */
  showOpacity?: boolean;
  /**
   * (Optional) Callback invoked when Command/Ctrl+Click on the label to reset.
   */
  onReset?: () => void;
  /**
   * "row": no visible label (the surrounding row provides it), "None" as the
   * empty placeholder, and a slashed swatch when there is no color.
   */
  variant?: "stacked" | "row";
  /**
   * Text shown in the field at rest instead of the color value, e.g. the
   * theme token name ("foreground") rather than its resolved oklch().
   */
  displayValue?: string;
};

export type ColorFormat = "hex" | "rgb" | "hsl" | "oklch";
