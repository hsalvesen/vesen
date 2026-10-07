// fastfetch as the page draws it: the logo and the details in two columns, the logo hidden from
// screen readers behind its name, and a WM Theme row that follows the theme without running
// fastfetch again (F030).
import { render } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import themes from '../../themes.json';
import { detailLines, fastfetchRows, STACK_BELOW_COLS } from '../commands/system/fastfetch.run';
import { logoFor } from '../commands/system/fastfetch.logos';
import { out } from '../output/model';
import { createSysInfo } from '../services/sysinfo';
import { theme } from '../stores/theme';
import OutputView from './OutputView.svelte';

function themeNamed(name: string) {
  const found = themes.find((t) => t.name.toLowerCase() === name);
  if (!found) throw new Error(`no theme ${name}`);
  return found;
}

afterEach(() => {
  theme.set(themeNamed('swamphen'));
});

describe('fastfetch on the page', () => {
  it('draws the logo beside the details, and renames the theme when it changes', async () => {
    theme.set(themeNamed('swamphen'));
    const snapshot = createSysInfo(null).snapshot();
    const rows = fastfetchRows({
      snapshot: { ...snapshot, os: { name: 'macOS', version: null, arch: 'arm64' } },
      hints: null,
      gpu: null,
      battery: null,
      storage: null,
      uptimeMs: 60_000,
      theme: 'swamphen',
      version: '2.0.0',
      timeZone: 'UTC',
    });
    const logo = logoFor('macOS');
    const block = out.columns([out.art(logo.art, logo.alt, 'scale', { fg: logo.colour, bold: true })], [out.lines(detailLines('guest', rows))], STACK_BELOW_COLS, 30);
    const { container } = render(OutputView, { blocks: [block] });
    await vi.dynamicImportSettled();
    for (let i = 0; i < 5; i += 1) await tick();

    const columns = container.querySelector('.columns');
    expect(columns?.getAttribute('style')).toContain('--stack-at: 60ch; --left: 30ch');
    expect(columns?.classList.contains('sized')).toBe(true);
    expect(columns?.querySelectorAll(':scope > .column')).toHaveLength(2);
    expect(container.querySelector('.art')?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('.sr-only')?.textContent).toBe('macOS logo');

    const wmTheme = () => Array.from(container.querySelectorAll('.text')).find((row) => row.textContent?.startsWith('WM Theme'))?.textContent;
    expect(wmTheme()).toBe('WM Theme: swamphen');
    theme.set(themeNamed('wombat'));
    flushSync();
    expect(wmTheme()).toBe(`WM Theme: ${themeNamed('wombat').name}`);
  });
});
