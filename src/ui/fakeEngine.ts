// Stand-in for src/engine/client.ts (same `Engine` interface). Swap via src/ui/deps.ts.
import {
  STITCH_JUMP, STITCH_NORMAL, STITCH_TRIM,
  type ColorBlock, type ConvertOptions, type ConvertResult, type Engine, type EngineProgress, type InputPage, type OutputFile,
} from '../types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const COLORS = ['#e8508a', '#f7c531', '#2f8f4e', '#4aa3df'];

export function createFakeEngine(): Engine {
  let ready: Promise<void> | null = null;
  return {
    init(onProgress?: (p: EngineProgress) => void) {
      ready ??= (async () => {
        const steps: [EngineProgress['stage'], string][] = [
          ['download', 'Downloading Python runtime (fake)…'],
          ['install', 'Installing Ink/Stitch (fake)…'],
        ];
        const total = 20;
        for (let i = 0; i <= total; i++) {
          const [stage, message] = steps[i < total / 2 ? 0 : 1];
          onProgress?.({ stage, message, fraction: i / total });
          await sleep(100);
        }
        onProgress?.({ stage: 'ready', message: 'Ready', fraction: 1 });
      })();
      return ready;
    },
    async convert(page: InputPage, options: ConvertOptions, baseName: string): Promise<ConvertResult> {
      await ready;
      await sleep(700);
      if (options.formats.length === 0) throw new Error('No output format selected.');
      const plan = fakePlan(page, options);
      const files: OutputFile[] = options.formats.map((format) => {
        const bytes = new Uint8Array(512 + plan.stitchCount * 3);
        bytes.set(new TextEncoder().encode(`FAKE-${format.toUpperCase()}\n`));
        return { format, filename: `${baseName}.${format}`, bytes };
      });
      return { plan, files, warnings: ['Fake engine: this is a placeholder pattern, not a real conversion.'] };
    },
  };
}

function fakePlan(page: InputPage, o: ConvertOptions) {
  const margin = Math.min(page.widthMm, page.heightMm) * 0.08;
  const n = 4;
  const gap = margin * 0.6;
  const bandW = (page.widthMm - 2 * margin - gap * (n - 1)) / n;
  const spacing = Math.max(0.3, o.fill.rowSpacingMm);
  const step = Math.max(0.5, o.fill.maxStitchLenMm);
  const blocks: ColorBlock[] = [];
  let jumps = 0;
  let trims = 0;
  let total = 0;
  for (let b = 0; b < n; b++) {
    const x0 = margin + b * (bandW + gap);
    const y0 = margin + (b % 2) * margin;
    const y1 = page.heightMm - margin - ((b + 1) % 2) * margin;
    const pts: number[] = [];
    const flags: number[] = [];
    const push = (x: number, y: number, f: number) => {
      pts.push(x, y);
      flags.push(f);
      if (f === STITCH_JUMP) jumps++;
      if (f === STITCH_TRIM) trims++;
    };
    push(x0, y0, b === 0 ? STITCH_JUMP : STITCH_TRIM);
    let row = 0;
    for (let y = y0; y <= y1; y += spacing, row++) {
      const dir = row % 2 === 0 ? 1 : -1;
      const xs = dir === 1 ? x0 : x0 + bandW;
      const xe = dir === 1 ? x0 + bandW : x0;
      const segs = Math.max(1, Math.ceil(bandW / step));
      for (let s = 0; s <= segs; s++) {
        if (s === 0 && row === 0) continue;
        const x = xs + ((xe - xs) * s) / segs;
        push(x, y, STITCH_NORMAL);
      }
      // a mid-block jump now and then, for show
      if (row > 0 && row % 40 === 0) push(xe, Math.min(y + spacing, y1), STITCH_JUMP);
    }
    total += flags.length;
    blocks.push({ color: COLORS[b % COLORS.length], threadName: `Fake thread ${b + 1}`, coords: Float32Array.from(pts), flags: Uint8Array.from(flags) });
  }
  return { widthMm: page.widthMm, heightMm: page.heightMm, colorBlocks: blocks, stitchCount: total, jumpCount: jumps, trimCount: trims };
}
