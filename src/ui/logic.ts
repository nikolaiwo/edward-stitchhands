// Pure, DOM-free logic for the UI (unit-tested in tests/ui).
import { DEFAULT_OPTIONS, FORMATS, type ConvertOptions, type Format, type StitchPlan } from '../types';

export interface Hoop {
  id: string;
  label: string;
  w: number;
  h: number;
}

export const HOOPS: Hoop[] = [
  { id: '100x100', label: '100 × 100 mm', w: 100, h: 100 },
  { id: '130x180', label: '130 × 180 mm', w: 130, h: 180 },
  { id: '160x260', label: '160 × 260 mm', w: 160, h: 260 },
  { id: '200x200', label: '200 × 200 mm', w: 200, h: 200 },
  { id: '200x300', label: '200 × 300 mm', w: 200, h: 300 },
  { id: '360x200', label: '360 × 200 mm', w: 360, h: 200 },
  { id: 'custom', label: 'Custom…', w: 150, h: 150 },
];

export const MIN_SIZE_MM = 5;
export const MAX_SIZE_MM = 1000;

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Orient the hoop (swap W/H) to match the design's orientation, so a landscape drawing uses the hoop sideways. */
export function orientHoop(designW: number, designH: number, hoop: { w: number; h: number }): { w: number; h: number } {
  const landscape = designW >= designH;
  const hoopLandscape = hoop.w >= hoop.h;
  return landscape === hoopLandscape ? { w: hoop.w, h: hoop.h } : { w: hoop.h, h: hoop.w };
}

export function exceedsHoop(w: number, h: number, hoop: { w: number; h: number }): boolean {
  const o = orientHoop(w, h, hoop);
  return w > o.w + 1e-6 || h > o.h + 1e-6;
}

/** Keep the size if it fits the hoop, otherwise scale down uniformly to fit (rounded down to 0.1 mm). */
export function fitToHoop(w: number, h: number, hoop: { w: number; h: number }): { w: number; h: number } {
  const o = orientHoop(w, h, hoop);
  const s = Math.min(1, o.w / w, o.h / h);
  if (s >= 1) return { w, h };
  return { w: Math.floor(w * s * 10) / 10, h: Math.floor(h * s * 10) / 10 };
}

/** Change one dimension; if aspect locked the other follows. */
export function resizeDimension(
  changed: 'w' | 'h',
  value: number,
  current: { w: number; h: number },
  lockAspect: boolean,
  aspect: number, // w / h of the original drawing
): { w: number; h: number } {
  const v = clamp(value, MIN_SIZE_MM, MAX_SIZE_MM);
  if (!lockAspect) return changed === 'w' ? { w: v, h: current.h } : { w: current.w, h: v };
  return changed === 'w' ? { w: v, h: round1(v / aspect) } : { w: round1(v * aspect), h: v };
}

// ---- fill density ----
export const DENSITY_MIN = 0.15;
export const DENSITY_MAX = 0.5;
export function densityLabel(rowSpacingMm: number): string {
  if (rowSpacingMm >= 0.35) return 'Light';
  if (rowSpacingMm <= 0.2) return 'Dense';
  return 'Normal';
}

// ---- stats ----
export const STITCHES_PER_MINUTE = 600;
export function estimateSeconds(stitches: number, spm = STITCHES_PER_MINUTE): number {
  return (stitches / spm) * 60;
}
export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h} h ${rm} min` : `${h} h`;
}
export interface PlanStats {
  stitches: number;
  colors: number;
  trims: number;
  jumps: number;
  widthMm: number;
  heightMm: number;
  seconds: number;
}
export function planStats(plan: StitchPlan): PlanStats {
  return {
    stitches: plan.stitchCount,
    colors: plan.colorBlocks.length,
    trims: plan.trimCount,
    jumps: plan.jumpCount,
    widthMm: plan.widthMm,
    heightMm: plan.heightMm,
    seconds: estimateSeconds(plan.stitchCount),
  };
}
export function formatKB(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

// ---- playback ----
export function blockCounts(plan: StitchPlan): number[] {
  return plan.colorBlocks.map((b) => b.flags.length);
}
export function totalStitches(counts: number[]): number {
  return counts.reduce((a, b) => a + b, 0);
}
/** How many stitches of each block are drawn when `n` stitches overall have been sewn. */
export function visibleCounts(counts: number[], n: number): number[] {
  let left = Math.max(0, Math.floor(n));
  return counts.map((c) => {
    const take = Math.min(c, left);
    left -= take;
    return take;
  });
}
/** Position of the most recently sewn stitch (stitch = -1 when nothing is sewn yet). */
export function locateStitch(counts: number[], n: number): { block: number; stitch: number } {
  let left = Math.max(0, Math.floor(n));
  if (left === 0) return { block: 0, stitch: -1 };
  for (let b = 0; b < counts.length; b++) {
    if (counts[b] === 0) continue;
    if (left <= counts[b]) return { block: b, stitch: left - 1 };
    left -= counts[b];
  }
  let last = counts.length - 1;
  while (last > 0 && counts[last] === 0) last--;
  return { block: Math.max(0, last), stitch: Math.max(0, counts[last] ?? 0) - 1 };
}

// ---- settings persistence ----
export interface Settings {
  options: ConvertOptions;
  lockAspect: boolean;
  hoopId: string;
  customHoop: { w: number; h: number };
}
export const SETTINGS_KEY = 'edward-stitchhands:settings:v1';

export function defaultSettings(): Settings {
  return {
    options: structuredClone(DEFAULT_OPTIONS),
    lockAspect: true,
    hoopId: '130x180',
    customHoop: { w: 150, h: 150 },
  };
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function num(v: unknown, fallback: number, lo: number, hi: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
}
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

export function sanitizeSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, any>;
  const o = (r.options ?? {}) as Record<string, any>;
  const fill = (o.fill ?? {}) as Record<string, any>;
  const running = (o.running ?? {}) as Record<string, any>;
  const formats: Format[] = Array.isArray(o.formats)
    ? FORMATS.filter((f) => (o.formats as unknown[]).includes(f))
    : d.options.formats;
  d.options = {
    formats,
    fill: {
      rowSpacingMm: num(fill.rowSpacingMm, d.options.fill.rowSpacingMm, 0.05, 2),
      angleDeg: num(fill.angleDeg, d.options.fill.angleDeg, -180, 180),
      maxStitchLenMm: num(fill.maxStitchLenMm, d.options.fill.maxStitchLenMm, 0.5, 12),
      underlay: bool(fill.underlay, d.options.fill.underlay),
    },
    running: {
      stitchLenMm: num(running.stitchLenMm, d.options.running.stitchLenMm, 0.5, 10),
      beanRepeats: Math.round(num(running.beanRepeats, d.options.running.beanRepeats, 0, 5)),
    },
    satinMinStrokeWidthMm:
      o.satinMinStrokeWidthMm === null ? null : num(o.satinMinStrokeWidthMm, d.options.satinMinStrokeWidthMm ?? 1, 0.2, 20),
    lockStitches: bool(o.lockStitches, d.options.lockStitches),
    trimJumpsLongerThanMm: num(o.trimJumpsLongerThanMm, d.options.trimJumpsLongerThanMm, 0, 100),
    minStitchLenMm: num(o.minStitchLenMm, d.options.minStitchLenMm, 0, 5),
  };
  d.lockAspect = bool(r.lockAspect, d.lockAspect);
  d.hoopId = HOOPS.some((h) => h.id === r.hoopId) ? r.hoopId : d.hoopId;
  const ch = (r.customHoop ?? {}) as Record<string, any>;
  d.customHoop = { w: num(ch.w, 150, MIN_SIZE_MM, MAX_SIZE_MM), h: num(ch.h, 150, MIN_SIZE_MM, MAX_SIZE_MM) };
  return d;
}

export function loadSettings(storage: StorageLike | null = defaultStorage()): Settings {
  try {
    const txt = storage?.getItem(SETTINGS_KEY);
    return sanitizeSettings(txt ? JSON.parse(txt) : null);
  } catch {
    return defaultSettings();
  }
}
export function saveSettings(s: Settings, storage: StorageLike | null = defaultStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(SETTINGS_KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}
export function currentHoop(s: Settings): { w: number; h: number } {
  if (s.hoopId === 'custom') return s.customHoop;
  const h = HOOPS.find((x) => x.id === s.hoopId) ?? HOOPS[1];
  return { w: h.w, h: h.h };
}
