import { cathodeModes, type CathodeMode } from '../stores/cathode';

/**
 * Reflects the CRT mode onto <html> as `crt-<mode>`, plus `crt-on` for any effect, so global
 * CSS (app.css) can style the terminal without every component knowing the mode.
 */
export function applyCathode(root: HTMLElement, mode: CathodeMode): void {
  for (const m of cathodeModes) root.classList.toggle(`crt-${m}`, m === mode && mode !== 'off');
  root.classList.toggle('crt-on', mode !== 'off');
}
