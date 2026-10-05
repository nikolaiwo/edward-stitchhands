/** Conversion of SVG length units to millimetres. User units / unitless / px are 96 dpi. */

export const MM_PER_PX = 25.4 / 96;

const MM_PER_UNIT: Record<string, number> = {
  mm: 1,
  cm: 10,
  in: 25.4,
  pt: 25.4 / 72,
  pc: 25.4 / 6,
  px: MM_PER_PX,
  '': MM_PER_PX,
};

/** Parse "12.5mm", "3in", "100" -> millimetres. Returns null for percentages, missing or unsupported values. */
export function lengthToMm(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-zA-Z%]*)\s*$/.exec(value);
  if (!m) return null;
  const factor = MM_PER_UNIT[m[2].toLowerCase()];
  if (factor === undefined) return null;
  const n = parseFloat(m[1]) * factor;
  return n > 0 && Number.isFinite(n) ? n : null;
}

/** Round for tidy attribute output. */
export function fmt(n: number): string {
  return String(Math.round(n * 10000) / 10000);
}
