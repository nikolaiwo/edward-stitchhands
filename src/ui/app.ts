import { FORMATS, FORMAT_LABELS, type ConvertResult, type Format, type InputDocument } from '../types';
import { createEngine, loadFile, resizePage } from './deps';
import {
  DENSITY_MAX, DENSITY_MIN, HOOPS, clamp, currentHoop, defaultSettings, densityLabel, exceedsHoop, fitToHoop, formatDuration,
  formatKB, loadSettings, locateStitch, blockCounts, orientHoop, planStats, resizeDimension, round1, sanitizeSettings, saveSettings,
  type Settings,
} from './logic';
import { StitchPreview } from './preview';
import { sampleSvgFile } from './sample';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const show = (el: HTMLElement, on = true) => el.classList.toggle('hidden', !on);
const nf = new Intl.NumberFormat('en');

export function initApp() {
  const engine = createEngine();
  let settings: Settings = loadSettings();
  let doc: InputDocument | null = null;
  let pageIdx = 0;
  let size = { w: 100, h: 100 };
  let aspect = 1;
  let initState: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  let converting = false;
  let result: ConvertResult | null = null;
  let urls: string[] = [];

  // ---------- elements ----------
  const dropzone = $('dropzone');
  const fileInput = $<HTMLInputElement>('file-input');
  const errorBox = $('error');
  const sizeW = $<HTMLInputElement>('size-w');
  const sizeH = $<HTMLInputElement>('size-h');
  const hoopSel = $<HTMLSelectElement>('hoop');
  const hoopW = $<HTMLInputElement>('hoop-w');
  const hoopH = $<HTMLInputElement>('hoop-h');
  const density = $<HTMLInputElement>('density');
  const angle = $<HTMLInputElement>('angle');
  const underlay = $<HTMLInputElement>('underlay');
  const lockStitches = $<HTMLInputElement>('lock-stitches');
  const runLen = $<HTMLInputElement>('run-len');
  const bean = $<HTMLInputElement>('bean');
  const satin = $<HTMLInputElement>('satin');
  const satinOff = $<HTMLInputElement>('satin-off');
  const maxLen = $<HTMLInputElement>('max-len');
  const trim = $<HTMLInputElement>('trim');
  const minLen = $<HTMLInputElement>('min-len');
  const lockBtn = $<HTMLButtonElement>('lock');
  const convertBtn = $<HTMLButtonElement>('convert');

  function showError(msg: string | null) {
    errorBox.textContent = '';
    if (!msg) return show(errorBox, false);
    errorBox.append(msg);
    show(errorBox, true);
  }

  // ---------- settings <-> controls ----------
  HOOPS.forEach((h) => hoopSel.add(new Option(h.label, h.id)));
  const formatsEl = $('formats');
  FORMATS.forEach((f) => {
    const label = document.createElement('label');
    label.className = 'check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = f;
    cb.dataset.format = f;
    label.append(cb, ' ' + FORMAT_LABELS[f]);
    formatsEl.append(label);
  });
  const formatBoxes = () => [...formatsEl.querySelectorAll<HTMLInputElement>('input')];

  function writeControls() {
    const o = settings.options;
    hoopSel.value = settings.hoopId;
    hoopW.value = String(settings.customHoop.w);
    hoopH.value = String(settings.customHoop.h);
    document.querySelectorAll('.custom-hoop').forEach((e) => show(e as HTMLElement, settings.hoopId === 'custom'));
    density.value = String(-clamp(o.fill.rowSpacingMm, DENSITY_MIN, DENSITY_MAX));
    angle.value = String(((o.fill.angleDeg % 180) + 180) % 180);
    underlay.checked = o.fill.underlay;
    lockStitches.checked = o.lockStitches;
    runLen.value = String(o.running.stitchLenMm);
    bean.value = String(o.running.beanRepeats);
    satinOff.checked = o.satinMinStrokeWidthMm === null;
    satin.value = String(o.satinMinStrokeWidthMm ?? 1);
    satin.disabled = satinOff.checked;
    maxLen.value = String(o.fill.maxStitchLenMm);
    trim.value = String(o.trimJumpsLongerThanMm);
    minLen.value = String(o.minStitchLenMm);
    formatBoxes().forEach((b) => (b.checked = o.formats.includes(b.value as Format)));
    lockBtn.setAttribute('aria-pressed', String(settings.lockAspect));
    updateOutputs();
    updateConvertState();
  }

  function updateOutputs() {
    $('density-out').textContent = densityLabel(settings.options.fill.rowSpacingMm) + ` (${settings.options.fill.rowSpacingMm} mm)`;
    $('angle-out').textContent = `${angle.value}°`;
  }

  const n = (el: HTMLInputElement, fb: number) => (el.value.trim() === '' || !Number.isFinite(+el.value) ? fb : +el.value);

  function readControls() {
    const o = settings.options;
    settings = sanitizeSettings({
      lockAspect: settings.lockAspect,
      hoopId: hoopSel.value,
      customHoop: { w: n(hoopW, settings.customHoop.w), h: n(hoopH, settings.customHoop.h) },
      options: {
        formats: formatBoxes().filter((b) => b.checked).map((b) => b.value),
        fill: {
          rowSpacingMm: Math.round(-n(density, -o.fill.rowSpacingMm) * 100) / 100,
          angleDeg: n(angle, o.fill.angleDeg),
          maxStitchLenMm: n(maxLen, o.fill.maxStitchLenMm),
          underlay: underlay.checked,
        },
        running: { stitchLenMm: n(runLen, o.running.stitchLenMm), beanRepeats: n(bean, o.running.beanRepeats) },
        satinMinStrokeWidthMm: satinOff.checked ? null : n(satin, o.satinMinStrokeWidthMm ?? 1),
        lockStitches: lockStitches.checked,
        trimJumpsLongerThanMm: n(trim, o.trimJumpsLongerThanMm),
        minStitchLenMm: n(minLen, o.minStitchLenMm),
      },
    });
    saveSettings(settings);
    updateOutputs();
    updateConvertState();
  }

  const settingsForm = $('settings');
  settingsForm.addEventListener('input', (e) => {
    const t = e.target as HTMLElement;
    if (t === sizeW || t === sizeH) return;
    if (t === hoopSel) {
      readControls();
      writeControls();
      if (doc) {
        refit();
      }
      return;
    }
    readControls();
    if (t === satinOff) satin.disabled = satinOff.checked;
    if (t === hoopW || t === hoopH) updateHoopNote();
  });
  settingsForm.addEventListener('change', () => {
    writeControls();
    if (doc) updateHoopNote();
  });

  $('reset').addEventListener('click', () => {
    settings = defaultSettings();
    saveSettings(settings);
    writeControls();
    if (doc) refit();
  });

  // ---------- size ----------
  function showSize() {
    sizeW.value = String(round1(size.w));
    sizeH.value = String(round1(size.h));
    updateHoopNote();
  }
  function updateHoopNote() {
    const note = $('hoop-note');
    const hoop = currentHoop(settings);
    const bad = exceedsHoop(size.w, size.h, hoop);
    note.textContent = bad
      ? `Larger than the ${hoop.w} × ${hoop.h} mm hoop — it will not fit on your machine.`
      : `Fits the ${hoop.w} × ${hoop.h} mm hoop.`;
    note.className = 'small ' + (bad ? 'warn-text' : 'muted');
    if (result) preview.setHoop(orientHoop(result.plan.widthMm, result.plan.heightMm, hoop));
  }
  function refit() {
    if (!doc) return;
    size = fitToHoop(size.w, size.h, currentHoop(settings));
    showSize();
    updateOrig();
  }
  function onSizeInput(which: 'w' | 'h') {
    const el = which === 'w' ? sizeW : sizeH;
    const v = parseFloat(el.value);
    if (!Number.isFinite(v) || v <= 0) return;
    size = resizeDimension(which, v, size, settings.lockAspect, aspect);
    if (which === 'w') sizeH.value = String(size.h);
    else sizeW.value = String(size.w);
    updateHoopNote();
    updateOrig();
  }
  sizeW.addEventListener('input', () => onSizeInput('w'));
  sizeH.addEventListener('input', () => onSizeInput('h'));
  for (const el of [sizeW, sizeH]) {
    el.addEventListener('change', () => {
      onSizeInput(el === sizeW ? 'w' : 'h');
      showSize();
    });
  }
  lockBtn.addEventListener('click', () => {
    settings.lockAspect = !settings.lockAspect;
    lockBtn.setAttribute('aria-pressed', String(settings.lockAspect));
    saveSettings(settings);
    if (settings.lockAspect) onSizeInput('w');
  });

  // ---------- engine ----------
  function startInit() {
    if (initState === 'loading' || initState === 'ready') return;
    initState = 'loading';
    const box = $('engine-status');
    show(box, true);
    box.classList.remove('done');
    const bar = $<HTMLProgressElement>('engine-bar');
    const msg = $('engine-msg');
    const pct = $('engine-pct');
    bar.removeAttribute('value');
    msg.textContent = 'Starting the stitching engine…';
    engine
      .init((p) => {
        msg.textContent = p.message;
        if (p.fraction !== undefined) {
          bar.value = Math.round(p.fraction * 100);
          pct.textContent = `${Math.round(p.fraction * 100)}%`;
        }
      })
      .then(() => {
        initState = 'ready';
        msg.textContent = 'Stitching engine ready.';
        bar.value = 100;
        pct.textContent = '';
        box.classList.add('done');
        updateConvertState();
        setTimeout(() => initState === 'ready' && !converting && show(box, false), 2500);
      })
      .catch((err) => {
        initState = 'error';
        msg.textContent = 'The stitching engine failed to load.';
        showError(`Could not load the stitching engine: ${errMsg(err)}`);
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'btn secondary';
        retry.textContent = 'Retry';
        retry.addEventListener('click', () => {
          initState = 'idle';
          showError(null);
          startInit();
        }, { once: true });
        errorBox.append(' ', retry);
        updateConvertState();
      });
    updateConvertState();
  }

  const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

  function updateConvertState() {
    const hint = $('convert-hint');
    const hasFormat = settings.options.formats.length > 0;
    convertBtn.disabled = !(initState === 'ready' && doc && hasFormat && !converting);
    hint.textContent = converting
      ? 'Stitching…'
      : !doc
        ? ''
        : !hasFormat
          ? 'Select at least one output format.'
          : initState === 'ready'
            ? ''
            : initState === 'error'
              ? 'Engine failed to load — see the error above.'
              : 'Waiting for the stitching engine to finish loading…';
  }

  // ---------- files ----------
  function revokeUrls() {
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls = [];
  }
  const svgUrl = (svg: string) => {
    const u = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    urls.push(u);
    return u;
  };

  async function handleFile(file: File) {
    showError(null);
    startInit();
    try {
      const d = await loadFile(file);
      if (!d.pages.length) throw new Error('The file contains no pages.');
      revokeUrls();
      doc = d;
      result = null;
      stopPlayback();
      show($('result'), false);
      $('doc-name').textContent = d.name;
      const w = $('doc-warnings');
      w.textContent = '';
      d.warnings.forEach((t) => w.append(li(t)));
      show(w, d.warnings.length > 0);
      show($('intake'), false);
      show($('workspace'), true);
      buildPages();
      setPage(0);
      updateConvertState();
      $('workspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      showError(`Could not read that file: ${errMsg(e)}`);
    }
  }

  const li = (t: string) => {
    const e = document.createElement('li');
    e.textContent = t;
    return e;
  };

  function buildPages() {
    const list = $('page-list');
    list.textContent = '';
    const multi = !!doc && doc.pages.length > 1;
    show($('pages'), multi);
    if (!multi || !doc) return;
    doc.pages.forEach((p, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'page-thumb';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', 'false');
      b.dataset.index = String(i);
      const img = document.createElement('img');
      img.alt = '';
      img.src = svgUrl(p.svg);
      const cap = document.createElement('span');
      cap.textContent = `Page ${i + 1}`;
      b.append(img, cap);
      b.addEventListener('click', () => setPage(i));
      list.append(b);
    });
  }

  function setPage(i: number) {
    if (!doc) return;
    pageIdx = i;
    const p = doc.pages[i];
    aspect = p.widthMm / p.heightMm;
    size = fitToHoop(p.widthMm, p.heightMm, currentHoop(settings));
    document.querySelectorAll<HTMLElement>('.page-thumb').forEach((b, k) => b.setAttribute('aria-checked', String(k === i)));
    showSize();
    updateOrig();
  }

  function updateOrig() {
    if (!doc) return;
    const p = doc.pages[pageIdx];
    const img = $<HTMLImageElement>('orig-img');
    const old = img.src;
    img.src = svgUrl(resizePage(p, size.w, size.h).svg);
    if (old.startsWith('blob:')) {
      URL.revokeObjectURL(old);
      urls = urls.filter((u) => u !== old);
    }
    $('orig-info').textContent = `Original size ${round1(p.widthMm)} × ${round1(p.heightMm)} mm${size.w !== p.widthMm || size.h !== p.heightMm ? ` · stitched at ${round1(size.w)} × ${round1(size.h)} mm` : ''}`;
  }

  // dropzone + picker
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) void handleFile(f);
    fileInput.value = '';
  });
  window.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
      dropzone.classList.add('drag');
    }
  });
  window.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) dropzone.classList.remove('drag');
  });
  window.addEventListener('drop', (e) => {
    dropzone.classList.remove('drag');
    const f = e.dataTransfer?.files?.[0];
    if (f) {
      e.preventDefault();
      void handleFile(f);
    }
  });
  window.addEventListener('paste', (e) => {
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    const text = e.clipboardData?.getData('text') ?? '';
    if (/<svg[\s>]/i.test(text)) {
      e.preventDefault();
      void handleFile(new File([text], 'pasted.svg', { type: 'image/svg+xml' }));
    }
  });
  $('example-btn').addEventListener('click', () => void handleFile(sampleSvgFile()));
  $('change-file').addEventListener('click', () => {
    show($('intake'), true);
    $('intake').scrollIntoView({ behavior: 'smooth' });
    dropzone.focus();
  });

  // ---------- convert ----------
  convertBtn.addEventListener('click', async () => {
    if (!doc || converting || initState !== 'ready') return;
    converting = true;
    showError(null);
    show($('convert-spin'), true);
    $('convert-label').textContent = 'Stitching…';
    updateConvertState();
    try {
      const base = doc.name.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_') || 'design';
      const name = doc.pages.length > 1 ? `${base}-page${pageIdx + 1}` : base;
      const page = resizePage(doc.pages[pageIdx], size.w, size.h);
      const res = await engine.convert(page, { ...settings.options, formats: [...settings.options.formats] }, name);
      result = res;
      showResult(res);
    } catch (e) {
      showError(`Conversion failed: ${errMsg(e)} You can adjust the settings and try again.`);
    } finally {
      converting = false;
      show($('convert-spin'), false);
      $('convert-label').textContent = 'Convert to embroidery';
      updateConvertState();
    }
  });

  // ---------- result ----------
  const preview = new StitchPreview($<HTMLCanvasElement>('stitch-canvas'));
  const scrub = $<HTMLInputElement>('scrub');
  const playBtn = $<HTMLButtonElement>('play');
  let counts: number[] = [];
  let pos = 0;
  let playing = false;
  let lastT = 0;
  let hidden = new Set<number>();

  function showResult(res: ConvertResult) {
    const plan = res.plan;
    show($('result'), true);
    stopPlayback();
    counts = blockCounts(plan);
    hidden = new Set();
    preview.setPlan(plan);
    preview.setHoop(orientHoop(plan.widthMm, plan.heightMm, currentHoop(settings)));
    scrub.max = String(preview.total);
    setPos(preview.total);

    const s = planStats(plan);
    const dl = $('stats');
    dl.textContent = '';
    const rows: [string, string][] = [
      ['Stitches', nf.format(s.stitches)],
      ['Colors', String(s.colors)],
      ['Trims', String(s.trims)],
      ['Jumps', String(s.jumps)],
      ['Size', `${round1(s.widthMm)} × ${round1(s.heightMm)} mm`],
      ['Est. time', `${formatDuration(s.seconds)} @ 600/min`],
    ];
    for (const [k, v] of rows) {
      const wrap = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      wrap.append(dt, dd);
      dl.append(wrap);
    }

    const ul = $('swatches');
    ul.textContent = '';
    plan.colorBlocks.forEach((b, i) => {
      const item = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'swatch';
      btn.setAttribute('aria-pressed', 'true');
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.style.background = b.color;
      const label = document.createElement('span');
      label.textContent = `${i + 1}. ${b.threadName ?? b.color} · ${nf.format(b.flags.length)} stitches`;
      btn.append(chip, label);
      btn.addEventListener('click', () => {
        if (hidden.has(i)) hidden.delete(i);
        else hidden.add(i);
        btn.setAttribute('aria-pressed', String(!hidden.has(i)));
        preview.setHidden(hidden);
      });
      item.append(btn);
      ul.append(item);
    });

    const dls = $('downloads');
    dls.textContent = '';
    res.files.forEach((f) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn secondary dl';
      b.textContent = `${f.format.toUpperCase()} · ${formatKB(f.bytes.byteLength)}`;
      b.title = f.filename;
      b.setAttribute('aria-label', `Download ${f.filename} (${formatKB(f.bytes.byteLength)})`);
      b.addEventListener('click', () => download(new Blob([f.bytes as BlobPart]), f.filename));
      dls.append(b);
    });
    if (res.files.length > 1) {
      const z = document.createElement('button');
      z.type = 'button';
      z.className = 'btn primary dl';
      z.textContent = 'Download all (.zip)';
      z.addEventListener('click', async () => {
        z.disabled = true;
        try {
          const JSZip = (await import('jszip')).default;
          const zip = new JSZip();
          res.files.forEach((f) => zip.file(f.filename, f.bytes));
          const blob = await zip.generateAsync({ type: 'blob' });
          download(blob, `${res.files[0].filename.replace(/\.[^.]+$/, '')}.zip`);
        } catch (e) {
          showError(`Could not create the zip: ${errMsg(e)}`);
        } finally {
          z.disabled = false;
        }
      });
      dls.append(z);
    }

    const rw = $('result-warnings');
    rw.textContent = '';
    res.warnings.forEach((t) => rw.append(li(t)));
    show(rw, res.warnings.length > 0);
    $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function download(blob: Blob, filename: string) {
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = u;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 10_000);
  }

  function setPos(v: number) {
    const total = preview.total;
    pos = clamp(v, 0, total);
    scrub.value = String(Math.floor(pos));
    preview.setProgress(pos >= total ? Infinity : Math.floor(pos));
    const at = locateStitch(counts, Math.floor(pos));
    $('progress-text').textContent =
      pos >= total
        ? `All ${nf.format(total)} stitches`
        : `Stitch ${nf.format(Math.floor(pos))} of ${nf.format(total)} · color ${at.block + 1} of ${counts.length}`;
  }

  function tick(t: number) {
    if (!playing) return;
    const dt = Math.min(0.1, (t - lastT) / 1000);
    lastT = t;
    setPos(pos + dt * +$<HTMLSelectElement>('speed').value);
    if (pos >= preview.total) return stopPlayback();
    requestAnimationFrame(tick);
  }
  function startPlayback() {
    if (pos >= preview.total) setPos(0);
    playing = true;
    playBtn.textContent = '⏸';
    playBtn.setAttribute('aria-label', 'Pause');
    lastT = performance.now();
    requestAnimationFrame(tick);
  }
  function stopPlayback() {
    playing = false;
    playBtn.textContent = '▶';
    playBtn.setAttribute('aria-label', 'Play');
  }
  playBtn.addEventListener('click', () => (playing ? stopPlayback() : startPlayback()));
  scrub.addEventListener('input', () => {
    stopPlayback();
    setPos(+scrub.value);
  });
  $('zoom-in').addEventListener('click', () => preview.zoomBy(1.3));
  $('zoom-out').addEventListener('click', () => preview.zoomBy(1 / 1.3));
  $('fit').addEventListener('click', () => preview.fit());
  $<HTMLInputElement>('show-jumps').addEventListener('change', (e) => {
    preview.showJumps = (e.target as HTMLInputElement).checked;
    preview.redraw();
  });
  $<HTMLInputElement>('realistic').addEventListener('change', (e) => {
    preview.realistic = (e.target as HTMLInputElement).checked;
    preview.redraw();
  });

  writeControls();
  updateHoopNote();
}
