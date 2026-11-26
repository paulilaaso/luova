declare module "culori" {
  export function parse(color: string): any;
  export function converter(mode: string): (color: any) => any;
  export function formatRgb(color: any): string;
  export function formatHex(color: any): string;
  export function formatHex8(color: any): string;
  export function wcagLuminance(color: any): number;
  export function interpolate(colors: any[], mode: string): (t: number) => any;
  export type Color = any;
  export interface Oklch {
    mode: string;
    l: number;
    c: number;
    h: number;
    alpha?: number;
  }
  export interface Hsl {
    mode: string;
    h: number;
    s: number;
    l: number;
    alpha?: number;
  }
}
