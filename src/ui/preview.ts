// Canvas renderer for a StitchPlan: zoom/pan, hoop outline, playback progress, per-block visibility.
import { STITCH_NORMAL, type StitchPlan } from '../types';
import { blockCounts, totalStitches, visibleCounts } from './logic';

export class StitchPreview {
  private ctx: CanvasRenderingContext2D;
  private plan: StitchPlan | null = null;
  private counts: number[] = [];
  private hoop: { w: number; h: number } | null = null;
  private hidden = new Set<number>();
  private progress = Infinity;
  private scale = 1;
  private ox = 0;
  private oy = 0;
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private raf = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private lastPinch = 0;
  private userMoved = false;
  showJumps = false;
  realistic = false;

  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(canvas);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.redraw());
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      this.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    }, { passive: false });
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.lastPinch = this.pinchDist();
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.pointers.size === 1) {
        this.userMoved = true;
        this.ox += dx;
        this.oy += dy;
        this.redraw();
      } else if (this.pointers.size === 2) {
        const d = this.pinchDist();
        const r = canvas.getBoundingClientRect();
        const [a, b] = [...this.pointers.values()];
        if (this.lastPinch > 0) this.zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, d / this.lastPinch);
        this.lastPinch = d;
      }
    });
    const up = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      this.lastPinch = this.pinchDist();
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('dblclick', () => this.fit());
    canvas.addEventListener('keydown', (e) => {
      const k = e.key;
      const c = { x: this.cssW / 2, y: this.cssH / 2 };
      if (k === '+' || k === '=') this.zoomAt(c.x, c.y, 1.25);
      else if (k === '-') this.zoomAt(c.x, c.y, 0.8);
      else if (k === '0') this.fit();
      else if (k === 'ArrowLeft') (this.ox += 30), this.redraw();
      else if (k === 'ArrowRight') (this.ox -= 30), this.redraw();
      else if (k === 'ArrowUp') (this.oy += 30), this.redraw();
      else if (k === 'ArrowDown') (this.oy -= 30), this.redraw();
      else return;
      e.preventDefault();
    });
  }

  private pinchDist(): number {
    if (this.pointers.size < 2) return 0;
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  setPlan(plan: StitchPlan | null) {
    this.plan = plan;
    this.counts = plan ? blockCounts(plan) : [];
    this.hidden.clear();
    this.progress = Infinity;
    this.fit();
  }
  setHoop(h: { w: number; h: number } | null) {
    this.hoop = h;
    this.fit();
  }
  setHidden(hidden: Set<number>) {
    this.hidden = hidden;
    this.redraw();
  }
  /** Number of stitches sewn so far (Infinity = all). */
  setProgress(n: number) {
    this.progress = n;
    this.redraw();
  }
  get total(): number {
    return totalStitches(this.counts);
  }

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    if (r.width === 0) return;
    const firstTime = this.cssW === 0;
    this.dpr = window.devicePixelRatio || 1;
    this.cssW = r.width;
    this.cssH = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    if (firstTime || !this.userMoved) this.fit();
    else this.redraw();
  }

  /** World bounds (mm) to show: the design, plus the hoop centred on it. */
  private bounds() {
    const p = this.plan;
    if (!p) return { x0: 0, y0: 0, x1: 1, y1: 1 };
    let x0 = 0, y0 = 0, x1 = p.widthMm, y1 = p.heightMm;
    if (this.hoop) {
      const cx = p.widthMm / 2, cy = p.heightMm / 2;
      x0 = Math.min(x0, cx - this.hoop.w / 2);
      x1 = Math.max(x1, cx + this.hoop.w / 2);
      y0 = Math.min(y0, cy - this.hoop.h / 2);
      y1 = Math.max(y1, cy + this.hoop.h / 2);
    }
    return { x0, y0, x1, y1 };
  }

  fit() {
    this.userMoved = false;
    if (!this.cssW) return;
    const b = this.bounds();
    const pad = 16;
    const s = Math.min((this.cssW - 2 * pad) / (b.x1 - b.x0), (this.cssH - 2 * pad) / (b.y1 - b.y0));
    this.scale = Math.max(s, 0.01);
    this.ox = (this.cssW - (b.x1 - b.x0) * this.scale) / 2 - b.x0 * this.scale;
    this.oy = (this.cssH - (b.y1 - b.y0) * this.scale) / 2 - b.y0 * this.scale;
    this.redraw();
  }

  zoomAt(px: number, py: number, factor: number) {
    this.userMoved = true;
    const ns = Math.min(400, Math.max(0.05, this.scale * factor));
    const f = ns / this.scale;
    this.ox = px - (px - this.ox) * f;
    this.oy = py - (py - this.oy) * f;
    this.scale = ns;
    this.redraw();
  }
  zoomBy(factor: number) {
    this.zoomAt(this.cssW / 2, this.cssH / 2, factor);
  }

  redraw() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  }

  private css(name: string, fallback: string): string {
    return getComputedStyle(this.canvas).getPropertyValue(name).trim() || fallback;
  }

  private draw() {
    const { ctx, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = this.css('--canvas-bg', '#fff');
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    const p = this.plan;
    if (!p) return;
    ctx.save();
    ctx.translate(this.ox, this.oy);
    ctx.scale(this.scale, this.scale);

    // design area + hoop
    ctx.lineWidth = 1 / this.scale;
    ctx.fillStyle = this.css('--fabric', '#f6efe3');
    if (this.hoop) {
      const hx = p.widthMm / 2 - this.hoop.w / 2;
      const hy = p.heightMm / 2 - this.hoop.h / 2;
      ctx.fillRect(hx, hy, this.hoop.w, this.hoop.h);
      ctx.strokeStyle = this.css('--hoop', '#b08968');
      ctx.setLineDash([]);
      ctx.lineWidth = 2 / this.scale;
      ctx.strokeRect(hx, hy, this.hoop.w, this.hoop.h);
    }
    ctx.strokeStyle = this.css('--muted', '#888');
    ctx.globalAlpha = 0.5;
    ctx.setLineDash([4 / this.scale, 4 / this.scale]);
    ctx.lineWidth = 1 / this.scale;
    ctx.strokeRect(0, 0, p.widthMm, p.heightMm);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    const vis = visibleCounts(this.counts, this.progress);
    const lw = this.realistic ? Math.max(0.35, 1.6 / this.scale) : Math.max(0.12, 1 / this.scale);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const dots = this.scale > 14;
    let lastPoint: { x: number; y: number; block: number; color: string } | null = null;

    for (let bi = 0; bi < p.colorBlocks.length; bi++) {
      const blk = p.colorBlocks[bi];
      const n = vis[bi];
      if (n === 0) continue;
      const c = blk.coords;
      const f = blk.flags;
      const hide = this.hidden.has(bi);
      if (!hide) {
        // jumps (including the one connecting from the previous block)
        if (this.showJumps) {
          ctx.save();
          ctx.setLineDash([2 / this.scale, 3 / this.scale]);
          ctx.strokeStyle = this.css('--jump', '#c0392b');
          ctx.lineWidth = 1 / this.scale;
          ctx.beginPath();
          if (lastPoint) {
            ctx.moveTo(lastPoint.x, lastPoint.y);
            ctx.lineTo(c[0], c[1]);
          }
          for (let i = 1; i < n; i++) {
            if (f[i] !== STITCH_NORMAL) {
              ctx.moveTo(c[2 * i - 2], c[2 * i - 1]);
              ctx.lineTo(c[2 * i], c[2 * i + 1]);
            }
          }
          ctx.stroke();
          ctx.restore();
        }
        const passes = this.realistic ? [0, 1, 2] : [1];
        for (const pass of passes) {
          ctx.beginPath();
          const off = pass === 0 ? lw * 0.18 : pass === 2 ? -lw * 0.12 : 0;
          for (let i = 1; i < n; i++) {
            if (f[i] !== STITCH_NORMAL) continue;
            ctx.moveTo(c[2 * i - 2] + off, c[2 * i - 1] + off);
            ctx.lineTo(c[2 * i] + off, c[2 * i + 1] + off);
          }
          ctx.lineWidth = pass === 2 ? lw * 0.3 : lw;
          ctx.strokeStyle = pass === 0 ? 'rgba(0,0,0,0.35)' : pass === 2 ? 'rgba(255,255,255,0.35)' : blk.color;
          ctx.stroke();
        }
        if (dots) {
          ctx.fillStyle = this.css('--dot', '#333');
          const r = 0.6 / this.scale * 1.2;
          for (let i = 0; i < n; i++) {
            ctx.fillRect(c[2 * i] - r / 2, c[2 * i + 1] - r / 2, r, r);
          }
        }
      }
      lastPoint = { x: c[2 * (n - 1)], y: c[2 * (n - 1) + 1], block: bi, color: blk.color };
    }

    // needle marker when playing back
    if (lastPoint && this.progress < this.total) {
      ctx.beginPath();
      ctx.arc(lastPoint.x, lastPoint.y, 5 / this.scale, 0, Math.PI * 2);
      ctx.fillStyle = lastPoint.color;
      ctx.fill();
      ctx.lineWidth = 1.5 / this.scale;
      ctx.strokeStyle = this.css('--text', '#000');
      ctx.stroke();
    }
    ctx.restore();
  }
}
