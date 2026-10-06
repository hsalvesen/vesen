import { describe, expect, it } from 'vitest';
import { parseSgr } from '../output/sgr';
import { createFmt } from './fmt';

describe('ctx.fmt', () => {
  it('writes SGR on the screen that the screen reads back as styles', () => {
    const fmt = createFmt(true);
    const line = `${fmt.fg('red', 'r')}${fmt.fg('error', 'e')}${fmt.bold('b')}${fmt.dim('d')}${fmt.underline('u')}${fmt.fg('muted', 'm')}`;
    expect(parseSgr(line).lines[0]).toEqual([
      { text: 'r', style: { fg: 'red' } },
      { text: 'e', style: { fg: 'red' } },
      { text: 'b', style: { bold: true } },
      { text: 'd', style: { dim: true } },
      { text: 'u', style: { underline: true } },
      { text: 'm', style: { dim: true } },
    ]);
    expect(parseSgr(fmt.fg('brightCyan', 'x')).lines[0]).toEqual([{ text: 'x', style: { fg: 'brightCyan' } }]);
  });

  it('links http, https and mailto with OSC 8, and nothing else', () => {
    const fmt = createFmt(true);
    expect(parseSgr(fmt.link('https://www.vesen.app/', 'site')).lines[0]).toEqual([{ text: 'site', href: 'https://www.vesen.app/' }]);
    expect(fmt.link('javascript:alert(1)', 'x')).toBe('x');
  });

  it('returns text unchanged off the screen, so pipes get plain text', () => {
    const fmt = createFmt(false);
    expect(fmt.enabled).toBe(false);
    expect(fmt.fg('red', 'r') + fmt.bold('b') + fmt.link('https://x.example/', 'l')).toBe('rbl');
  });
});
