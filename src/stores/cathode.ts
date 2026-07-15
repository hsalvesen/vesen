import { writable } from 'svelte/store';

// A "cathode" effect emulates the look of an old CRT (cathode ray tube) display.
// Each mode is a distinct variation the user can trial on the terminal.
export const cathodeModes = ['off', 'scanlines', 'phosphor', 'vintage'] as const;
export type CathodeMode = (typeof cathodeModes)[number];

export interface CathodeModeInfo {
  name: CathodeMode;
  summary: string;
}

// Ordered list used by the `cathode` command for listing/help output.
export const cathodeModeInfo: CathodeModeInfo[] = [
  { name: 'off', summary: 'No effect. A clean, modern flat display.' },
  { name: 'scanlines', summary: 'Subtle horizontal scanlines with a slow refresh sweep.' },
  { name: 'phosphor', summary: 'Glowing phosphor text, scanlines and a gentle flicker.' },
  { name: 'vintage', summary: 'The full retro set: glow, flicker, RGB fringing and a heavy vignette.' },
];

const STORAGE_KEY = 'cathode';
const CLASS_PREFIX = 'crt-';

function isCathodeMode(value: string | null): value is CathodeMode {
  return value !== null && (cathodeModes as readonly string[]).includes(value);
}

// Reflect the active mode onto <html> so global CSS can style the terminal
// (text glow, curvature) without every component needing to know the mode.
// `crt-on` is a convenience flag so selectors can target "any effect" cheaply.
function applyDocumentMode(mode: CathodeMode) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  cathodeModes.forEach((m) => root.classList.remove(`${CLASS_PREFIX}${m}`));
  root.classList.toggle('crt-on', mode !== 'off');
  if (mode !== 'off') {
    root.classList.add(`${CLASS_PREFIX}${mode}`);
  }
}

// Keep any previously printed "cathode ls" output in sync with the active mode.
function updateCathodeListHighlight(mode: CathodeMode) {
  if (typeof document === 'undefined') return;
  const nodes = document.querySelectorAll<HTMLElement>('.cathode-name');
  nodes.forEach((el) => {
    const name = el.getAttribute('data-cathode-name');
    el.classList.toggle('is-current', name === mode);
  });
}

const initialMode: CathodeMode =
  typeof localStorage !== 'undefined' && isCathodeMode(localStorage.getItem(STORAGE_KEY))
    ? (localStorage.getItem(STORAGE_KEY) as CathodeMode)
    : 'off';

if (typeof document !== 'undefined') {
  applyDocumentMode(initialMode);
  updateCathodeListHighlight(initialMode);
}

export const cathode = writable<CathodeMode>(initialMode);

cathode.subscribe((mode) => {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, mode);
  }
  applyDocumentMode(mode);
  updateCathodeListHighlight(mode);
});
