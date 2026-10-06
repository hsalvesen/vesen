import { cathodeModes, crtTiers, type CathodeMode, type CrtTier } from '../stores/cathode';

/**
 * Reflects the CRT mode and tier onto <html> so global CSS (app.css) can style the terminal
 * without every component knowing them: always one `crt-tier-<tier>`, and while an effect shows,
 * `crt-<mode>` plus `crt-on`. The off tier shows nothing whatever the mode.
 */
export function applyCathode(root: HTMLElement, mode: CathodeMode, tier: CrtTier = 'full'): void {
  const on = mode !== 'off' && tier !== 'off';
  for (const m of cathodeModes) root.classList.toggle(`crt-${m}`, on && m === mode);
  for (const t of crtTiers) root.classList.toggle(`crt-tier-${t}`, t === tier);
  root.classList.toggle('crt-on', on);
}
