// Shared contracts between input, engine and UI. Change only with care: all three modules depend on these.

export const FORMATS = ['dst', 'pes', 'jef', 'exp', 'vp3', 'xxx', 'pec', 'u01'] as const;
export type Format = (typeof FORMATS)[number];

export const FORMAT_LABELS: Record<Format, string> = {
  dst: 'DST — Tajima (universal)',
  pes: 'PES — Brother / Babylock',
  pec: 'PEC — Brother (legacy)',
  jef: 'JEF — Janome / Elna',
  exp: 'EXP — Melco / Bernina',
  vp3: 'VP3 — Husqvarna / Pfaff',
  xxx: 'XXX — Singer',
  u01: 'U01 — Barudan',
};

/** A drawing ready for the engine: an SVG string sized in real-world millimetres. */
export interface InputPage {
  /** SVG markup. Root has width="<n>mm" height="<n>mm" and a viewBox. */
  svg: string;
  widthMm: number;
  heightMm: number;
}

export interface InputDocument {
  name: string;
  kind: 'svg' | 'pdf';
  pages: InputPage[];
  warnings: string[];
}

export interface ConvertOptions {
  formats: Format[];
  fill: {
    /** Distance between fill rows (density). Ink/Stitch default 0.25. */
    rowSpacingMm: number;
    /** Fill angle in degrees. */
    angleDeg: number;
    /** Max stitch length within a fill row. Ink/Stitch default 3. */
    maxStitchLenMm: number;
    underlay: boolean;
  };
  running: {
    /** Running stitch length for strokes. Ink/Stitch default 2.5. */
    stitchLenMm: number;
    /** Bean stitch repeats (0 = plain running stitch). */
    beanRepeats: number;
  };
  /** Strokes at least this wide (mm) become satin columns; null disables. */
  satinMinStrokeWidthMm: number | null;
  /** Add tie-in/tie-off lock stitches. */
  lockStitches: boolean;
  /** Jumps longer than this get a trim command. */
  trimJumpsLongerThanMm: number;
  minStitchLenMm: number;
}

export const DEFAULT_OPTIONS: ConvertOptions = {
  formats: ['dst', 'pes'],
  fill: { rowSpacingMm: 0.25, angleDeg: 0, maxStitchLenMm: 3, underlay: true },
  running: { stitchLenMm: 2.5, beanRepeats: 0 },
  satinMinStrokeWidthMm: 1,
  lockStitches: true,
  trimJumpsLongerThanMm: 3,
  minStitchLenMm: 0.1,
};

export const STITCH_NORMAL = 0;
export const STITCH_JUMP = 1;
export const STITCH_TRIM = 2;

export interface ColorBlock {
  /** '#rrggbb' */
  color: string;
  /** Thread name if matched to a palette, e.g. "Madeira 1147". */
  threadName?: string;
  /** Interleaved x,y in mm, origin top-left of the design, y down. */
  coords: Float32Array;
  /** One flag per stitch: STITCH_NORMAL | STITCH_JUMP | STITCH_TRIM (trim happens before this stitch). */
  flags: Uint8Array;
}

export interface StitchPlan {
  widthMm: number;
  heightMm: number;
  colorBlocks: ColorBlock[];
  stitchCount: number;
  jumpCount: number;
  trimCount: number;
}

export interface OutputFile {
  format: Format;
  filename: string;
  bytes: Uint8Array;
}

export interface ConvertResult {
  plan: StitchPlan;
  files: OutputFile[];
  warnings: string[];
}

export type EngineProgress = { stage: 'download' | 'install' | 'ready' | 'convert'; message: string; fraction?: number };

/** Implemented by src/engine/client.ts; UI depends only on this interface. */
export interface Engine {
  init(onProgress?: (p: EngineProgress) => void): Promise<void>;
  convert(page: InputPage, options: ConvertOptions, baseName: string): Promise<ConvertResult>;
}
