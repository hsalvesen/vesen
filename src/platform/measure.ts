// Sets --input-scale on <html>: the terminal font size over 16px. On touch the command input is
// really 16px, so iOS never zooms in when it takes focus, and ui/prompt/LineEditor.svelte draws it
// at the terminal's size with this scale. It is measured when it starts, when the page has
// loaded, on resize, and when web fonts finish loading. The kill switch, ?input=plain or
// `--input-scale-off: 1` in CSS, keeps a plain 16px input (scale 1, and the class input-plain).

/** The input's real font size: iOS zooms into anything smaller when it takes focus. */
export const INPUT_FONT_PX = 16;

/** The scale that draws a 16px input at `termFontPx`; 1 when switched off or unmeasurable. */
export function inputScale(termFontPx: number, plain: boolean): number {
  if (plain || !Number.isFinite(termFontPx) || termFontPx <= 0) return 1;
  return Math.round((termFontPx / INPUT_FONT_PX) * 10_000) / 10_000;
}

/** True when the page asks for a plain input: `?input=plain`, or `--input-scale-off` set in CSS. */
export function plainInputRequested(search: string, scaleOff: string): boolean {
  if (new URLSearchParams(search).get('input') === 'plain') return true;
  const off = scaleOff.trim().toLowerCase();
  return off !== '' && off !== '0' && off !== 'false' && off !== 'none';
}

/** Measures the page once and writes the result. The body carries the terminal's font size. */
export function applyInputScale(win: Window): number {
  const root = win.document.documentElement;
  const body = win.document.body;
  const plain = plainInputRequested(win.location.search, win.getComputedStyle(root).getPropertyValue('--input-scale-off'));
  const scale = inputScale(body ? Number.parseFloat(win.getComputedStyle(body).fontSize) : Number.NaN, plain);
  root.style.setProperty('--input-scale', String(scale));
  root.classList.toggle('input-plain', plain);
  return scale;
}

/** Measures now and on every later trigger, at most once a frame. Returns a function that stops it. */
export function startMeasuring(win: Window): () => void {
  const fonts = win.document.fonts as FontFaceSet | undefined;
  let stopped = false;
  let frame = 0;

  const update = (): void => {
    frame = 0;
    if (!stopped) applyInputScale(win);
  };
  const schedule = (): void => {
    if (!stopped && frame === 0) frame = win.requestAnimationFrame(update);
  };

  update();
  win.addEventListener('load', schedule);
  win.addEventListener('resize', schedule);
  // A font may start loading only once text uses it, after `ready` has resolved for the page so
  // far, so each later load is caught by loadingdone.
  fonts?.ready.then(schedule, () => {});
  fonts?.addEventListener?.('loadingdone', schedule);

  return () => {
    stopped = true;
    win.cancelAnimationFrame(frame);
    win.removeEventListener('load', schedule);
    win.removeEventListener('resize', schedule);
    fonts?.removeEventListener?.('loadingdone', schedule);
  };
}

/** A cell's width in em when the stylesheet does not say: as wide as any fallback font's. */
const DEFAULT_CH_RATIO = 0.6;

/**
 * The legacy estimate of the terminal's width in cells, (innerWidth - 40) / 8, for a page with no
 * transcript to measure. The golden snapshots are recorded with it.
 */
export function estimatedColumns(innerWidth: number): number {
  return Math.floor(Math.max(innerWidth - 40, 200) / 8);
}

/**
 * How many cells fit across the transcript (<main>): its content width over the font size times
 * --ch-ratio, the cell width that art is fitted with. Falls back to the estimate from the window's
 * width when there is no laid-out transcript.
 */
export function transcriptColumns(win: Window): number {
  const main = win.document.querySelector('main');
  if (main && main.clientWidth > 0) {
    const style = win.getComputedStyle(main);
    const width = main.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
    const ratio = Number.parseFloat(win.getComputedStyle(win.document.documentElement).getPropertyValue('--ch-ratio'));
    const cell = Number.parseFloat(style.fontSize) * (ratio > 0 ? ratio : DEFAULT_CH_RATIO);
    if (width > 0 && cell > 0) return Math.floor(width / cell);
  }
  return estimatedColumns(win.innerWidth);
}
