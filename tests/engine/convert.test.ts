import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PyodideInterface } from 'pyodide';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, FORMATS, STITCH_JUMP, STITCH_NORMAL, STITCH_TRIM, type ConvertOptions, type Format } from '../../src/types.ts';
import { loadEngineInNode, root } from './pyodide-node.ts';

const TIMEOUT = 300_000;

interface PyBlock {
  color: string;
  threadName?: string;
  coords: Uint8Array;
  flags: Uint8Array;
}
interface PyResult {
  files: Record<string, Uint8Array>;
  plan: { widthMm: number; heightMm: number; stitchCount: number; jumpCount: number; trimCount: number; blocks: PyBlock[] };
  warnings: string[];
}

let pyodide: PyodideInterface;

function fixture(name: string): string {
  return readFileSync(join(root, 'tests/fixtures', name), 'utf8');
}

async function convert(svg: string, overrides: Partial<ConvertOptions> = {}, formats: readonly Format[] = FORMATS): Promise<PyResult> {
  const options: ConvertOptions = { ...DEFAULT_OPTIONS, ...overrides, formats: [...formats] };
  pyodide.globals.set('svg_in', svg);
  pyodide.globals.set('options_in', JSON.stringify(options));
  pyodide.globals.set('formats_in', pyodide.toPy(options.formats));
  const proxy = await pyodide.runPythonAsync(
    'from edward.convert import convert\nconvert(svg_in, options_in, list(formats_in), "test")',
  );
  const result = proxy.toJs({ dict_converter: Object.fromEntries }) as PyResult;
  proxy.destroy();
  return result;
}

function bbox(result: PyResult) {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const b of result.plan.blocks) {
    const c = new Float32Array(b.coords.slice().buffer);
    for (let i = 0; i < c.length; i += 2) {
      x0 = Math.min(x0, c[i]);
      x1 = Math.max(x1, c[i]);
      y0 = Math.min(y0, c[i + 1]);
      y1 = Math.max(y1, c[i + 1]);
    }
  }
  return [x0, y0, x1, y1];
}

function parseDstHeader(bytes: Uint8Array) {
  const header = new TextDecoder('latin1').decode(bytes.subarray(0, 512));
  const field = (key: string) => Number(new RegExp(`${key}:\\s*(-?\\d+)`).exec(header)?.[1]);
  return { label: /LA:([^\r\n]*)/.exec(header)?.[1], stitches: field('ST'), colors: field('CO'), px: field('\\+X'), nx: field('-X'), py: field('\\+Y'), ny: field('-Y') };
}

beforeAll(async () => {
  execFileSync('node', ['scripts/build-pybundle.mjs'], { cwd: root, stdio: 'inherit' });
  pyodide = await loadEngineInNode();
}, TIMEOUT);

describe('fixtures', () => {
  // [fixture, canvas mm, expected stitch bbox [x0,y0,x1,y1] in mm, distinct colours]
  const cases: [string, [number, number], number[], number][] = [
    ['shapes.svg', [60, 40], [5, 5, 53, 35], 3],
    ['strokes.svg', [50, 30], [5, 5, 45, 25], 2],
    ['satin.svg', [50, 30], [8, 6, 42, 17], 1],
    ['hole.svg', [40, 40], [5, 5, 35, 35], 1],
    ['nested.svg', [100, 60], [20, 10, 60, 50], 1],
    ['css.svg', [40, 30], [3, 3, 37, 22], 3],
    ['inch.svg', [50.8, 25.4], [14.8, 2.1, 36, 23.3], 1],
  ];

  it.each(cases)(
    '%s: all formats, plan extents, colours',
    async (name, [w, h], expected, colors) => {
      const result = await convert(fixture(name));
      const dump = process.env.EDWARD_DUMP_DIR;

      for (const format of FORMATS) {
        const bytes = result.files[format];
        expect(bytes?.length, `${format} bytes`).toBeGreaterThan(0);
        if (dump) {
          mkdirSync(dump, { recursive: true });
          writeFileSync(join(dump, name.replace('.svg', `.${format}`)), bytes);
        }
      }

      const header = parseDstHeader(result.files.dst);
      expect(header.stitches).toBeGreaterThan(0);
      expect(result.files.dst.length).toBe(512 + header.stitches * 3);
      // header extents (0.1 mm units) agree with the preview plan
      const [x0, y0, x1, y1] = bbox(result);
      expect((header.px + header.nx) / 10).toBeCloseTo(x1 - x0, 0);
      expect((header.py + header.ny) / 10).toBeCloseTo(y1 - y0, 0);

      const { plan } = result;
      expect(plan.stitchCount).toBeGreaterThan(0);
      expect(plan.widthMm).toBeCloseTo(w, 1);
      expect(plan.heightMm).toBeCloseTo(h, 1);
      expect(plan.blocks.length).toBe(colors);
      expect(header.colors).toBe(colors - 1);
      expect(new Set(plan.blocks.map((b) => b.color)).size).toBe(colors);

      // flags/coords are consistent and counts add up
      let normal = 0, jumps = 0, trims = 0;
      for (const b of plan.blocks) {
        expect(b.flags.length * 2 * 4).toBe(b.coords.length);
        for (const f of b.flags) {
          if (f === STITCH_NORMAL) normal++;
          else if (f === STITCH_JUMP) jumps++;
          else if (f === STITCH_TRIM) trims++;
          else throw new Error(`bad flag ${f}`);
        }
      }
      expect([plan.stitchCount, plan.jumpCount, plan.trimCount]).toEqual([normal, jumps, trims]);

      // origin is the canvas top-left, y down: stitches land where the shapes are drawn
      const [ex0, ey0, ex1, ey1] = expected;
      expect(Math.abs(x0 - ex0)).toBeLessThan(2);
      expect(Math.abs(y0 - ey0)).toBeLessThan(2);
      expect(Math.abs(x1 - ex1)).toBeLessThan(2);
      expect(Math.abs(y1 - ey1)).toBeLessThan(2);
    },
    TIMEOUT,
  );

  it('thin strokes stay running stitches; wide stroke becomes satin', async () => {
    const satin = await convert(fixture('satin.svg'), {}, ['dst']);
    const asRunning = await convert(fixture('satin.svg'), { satinMinStrokeWidthMm: null }, ['dst']);
    const [, sy0, , sy1] = bbox(satin);
    const [, ry0, , ry1] = bbox(asRunning);
    // a 3 mm satin column is much taller than the 1-px centre line and uses far more stitches
    expect(sy1 - sy0).toBeGreaterThan(ry1 - ry0 + 1.5);
    expect(satin.plan.stitchCount).toBeGreaterThan(asRunning.plan.stitchCount * 3);

    // strokes thinner than the threshold are never converted
    const thin = await convert(fixture('strokes.svg'), { satinMinStrokeWidthMm: 1 }, ['dst']);
    const thinRunning = await convert(fixture('strokes.svg'), { satinMinStrokeWidthMm: null }, ['dst']);
    expect(thin.plan.stitchCount).toBe(thinRunning.plan.stitchCount);
  }, TIMEOUT);

  it('fills skip the hole of a compound path', async () => {
    const result = await convert(fixture('hole.svg'), {}, ['dst']);
    for (const b of result.plan.blocks) {
      const c = new Float32Array(b.coords.slice().buffer);
      for (let i = 0; i < c.length; i += 2) {
        const inside = c[i] > 15 && c[i] < 25 && c[i + 1] > 15 && c[i + 1] < 25;
        expect(inside, `stitch at ${c[i]},${c[i + 1]} lies in the hole`).toBe(false);
      }
    }
  }, TIMEOUT);

  it('options change the output (density, lock stitches)', async () => {
    const dense = await convert(fixture('shapes.svg'), { fill: { ...DEFAULT_OPTIONS.fill, rowSpacingMm: 0.2 } }, ['dst']);
    const sparse = await convert(fixture('shapes.svg'), { fill: { ...DEFAULT_OPTIONS.fill, rowSpacingMm: 0.8 } }, ['dst']);
    expect(dense.plan.stitchCount).toBeGreaterThan(sparse.plan.stitchCount * 2);
    const locked = await convert(fixture('shapes.svg'), {}, ['dst']);
    const unlocked = await convert(fixture('shapes.svg'), { lockStitches: false }, ['dst']);
    expect(locked.plan.stitchCount).toBeGreaterThan(unlocked.plan.stitchCount);
  }, TIMEOUT);

  it('text yields a warning, not a crash', async () => {
    const result = await convert(fixture('text.svg'), {}, ['dst']);
    expect(result.warnings.join('\n')).toMatch(/text/i);
    expect(result.plan.blocks).toHaveLength(1);
    expect(result.plan.blocks[0].color).toBe('#336699');
  }, TIMEOUT);

  it('raises a clear error when nothing is stitchable', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="20mm" viewBox="0 0 20 20"><text x="2" y="10">Hi</text></svg>';
    await expect(convert(svg, {}, ['dst'])).rejects.toThrow(/Nothing to stitch/);
  }, TIMEOUT);

  it('is repeatable in one session (no state leaking between runs)', async () => {
    const a = await convert(fixture('shapes.svg'), {}, ['dst']);
    const b = await convert(fixture('shapes.svg'), {}, ['dst']);
    expect(Buffer.from(b.files.dst).equals(Buffer.from(a.files.dst))).toBe(true);
  }, TIMEOUT);
});
