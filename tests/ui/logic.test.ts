import { describe, expect, it } from 'vitest';
import {
  HOOPS, blockCounts, currentHoop, defaultSettings, densityLabel, estimateSeconds, exceedsHoop, fitToHoop,
  formatDuration, loadSettings, locateStitch, planStats, resizeDimension, saveSettings, SETTINGS_KEY, visibleCounts,
} from '../../src/ui/logic';
import type { StitchPlan } from '../../src/types';

function mem(initial?: string) {
  const m = new Map<string, string>();
  if (initial !== undefined) m.set(SETTINGS_KEY, initial);
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe('size fitting', () => {
  const hoop = { w: 100, h: 100 };
  it('keeps size when it fits', () => expect(fitToHoop(80, 60, hoop)).toEqual({ w: 80, h: 60 }));
  it('scales down preserving aspect', () => {
    const r = fitToHoop(200, 100, hoop);
    expect(r.w).toBeLessThanOrEqual(100);
    expect(r.w / r.h).toBeCloseTo(2, 1);
    expect(exceedsHoop(r.w, r.h, hoop)).toBe(false);
  });
  it('rotates the hoop for landscape designs', () => {
    expect(fitToHoop(170, 120, { w: 130, h: 180 })).toEqual({ w: 170, h: 120 });
    expect(exceedsHoop(170, 120, { w: 130, h: 180 })).toBe(false);
    expect(exceedsHoop(190, 120, { w: 130, h: 180 })).toBe(true);
  });
});

describe('aspect math', () => {
  it('locked: other follows', () => {
    expect(resizeDimension('w', 50, { w: 100, h: 50 }, true, 2)).toEqual({ w: 50, h: 25 });
    expect(resizeDimension('h', 20, { w: 100, h: 50 }, true, 2)).toEqual({ w: 40, h: 20 });
  });
  it('unlocked: independent, clamped', () => {
    expect(resizeDimension('w', 50, { w: 100, h: 50 }, false, 2)).toEqual({ w: 50, h: 50 });
    expect(resizeDimension('w', 1, { w: 100, h: 50 }, false, 2).w).toBe(5);
  });
  it('density labels', () => {
    expect(densityLabel(0.4)).toBe('Light');
    expect(densityLabel(0.25)).toBe('Normal');
    expect(densityLabel(0.15)).toBe('Dense');
  });
});

describe('settings persistence', () => {
  it('defaults when empty or corrupt', () => {
    expect(loadSettings(mem())).toEqual(defaultSettings());
    expect(loadSettings(mem('{not json'))).toEqual(defaultSettings());
  });
  it('round-trips', () => {
    const s = defaultSettings();
    s.options.formats = ['jef', 'dst'];
    s.options.satinMinStrokeWidthMm = null;
    s.hoopId = 'custom';
    s.customHoop = { w: 120, h: 90 };
    const st = mem();
    expect(saveSettings(s, st)).toBe(true);
    const back = loadSettings(st);
    expect(back.options.formats).toEqual(['dst', 'jef']);
    expect(back.options.satinMinStrokeWidthMm).toBeNull();
    expect(currentHoop(back)).toEqual({ w: 120, h: 90 });
  });
  it('sanitizes bad values', () => {
    const st = mem(
      JSON.stringify({ options: { formats: ['dst', 'bogus'], fill: { rowSpacingMm: 'x', angleDeg: 9999 } }, hoopId: 'nope' }),
    );
    const s = loadSettings(st);
    expect(s.options.formats).toEqual(['dst']);
    expect(s.options.fill.rowSpacingMm).toBe(0.25);
    expect(s.options.fill.angleDeg).toBe(180);
    expect(HOOPS.some((h) => h.id === s.hoopId)).toBe(true);
  });
  it('survives throwing storage', () => {
    const bad = {
      getItem: () => { throw new Error('x'); },
      setItem: () => { throw new Error('x'); },
      removeItem: () => {},
    };
    expect(loadSettings(bad)).toEqual(defaultSettings());
    expect(saveSettings(defaultSettings(), bad)).toBe(false);
  });
});

function plan(sizes: number[]): StitchPlan {
  return {
    widthMm: 40,
    heightMm: 30,
    stitchCount: sizes.reduce((a, b) => a + b, 0),
    jumpCount: 2,
    trimCount: 1,
    colorBlocks: sizes.map((n) => ({ color: '#000000', coords: new Float32Array(n * 2), flags: new Uint8Array(n) })),
  };
}

describe('stats', () => {
  it('estimates time at 600 spm', () => {
    expect(estimateSeconds(600)).toBe(60);
    expect(formatDuration(estimateSeconds(300))).toBe('30 s');
    expect(formatDuration(estimateSeconds(6000))).toBe('10 min');
    expect(formatDuration(3900)).toBe('1 h 5 min');
  });
  it('planStats', () => {
    const s = planStats(plan([600, 1200]));
    expect(s).toMatchObject({ stitches: 1800, colors: 2, trims: 1, jumps: 2, seconds: 180 });
  });
});

describe('playback mapping', () => {
  const counts = blockCounts(plan([3, 0, 4]));
  it('visibleCounts', () => {
    expect(visibleCounts(counts, 0)).toEqual([0, 0, 0]);
    expect(visibleCounts(counts, 2)).toEqual([2, 0, 0]);
    expect(visibleCounts(counts, 5)).toEqual([3, 0, 2]);
    expect(visibleCounts(counts, 99)).toEqual([3, 0, 4]);
  });
  it('locateStitch', () => {
    expect(locateStitch(counts, 0)).toEqual({ block: 0, stitch: -1 });
    expect(locateStitch(counts, 1)).toEqual({ block: 0, stitch: 0 });
    expect(locateStitch(counts, 3)).toEqual({ block: 0, stitch: 2 });
    expect(locateStitch(counts, 4)).toEqual({ block: 2, stitch: 0 });
    expect(locateStitch(counts, 7)).toEqual({ block: 2, stitch: 3 });
    expect(locateStitch(counts, 100)).toEqual({ block: 2, stitch: 3 });
  });
});
