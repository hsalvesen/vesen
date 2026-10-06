import { describe, expect, it } from 'vitest';
import {
  COMPONENT_NAMES,
  PALETTE,
  ROLES,
  colourVar,
  hexColour,
  isPalette,
  isRole,
  isTrustedAction,
  lineText,
  out,
  plain,
  safeHref,
  textWidth,
  charWidth,
  type Action,
  type Block,
  type BlockType,
} from './model';

describe('colour tokens', () => {
  it('maps palette entries to --theme-* in kebab case and roles to --role-*', () => {
    expect(colourVar('brightBlack')).toBe('var(--theme-bright-black)');
    expect(colourVar('foreground')).toBe('var(--theme-foreground)');
    expect(colourVar('fg-strong')).toBe('var(--role-fg-strong)');
    expect(colourVar('qr-paper')).toBe('var(--role-qr-paper)');
  });

  it('keeps palette and role names disjoint', () => {
    for (const name of PALETTE) expect(isRole(name)).toBe(false);
    for (const name of ROLES) expect(isPalette(name)).toBe(false);
    expect(ROLES).toHaveLength(22);
    expect(PALETTE).toHaveLength(18);
  });
});

describe('safeHref', () => {
  it('accepts absolute http, https and mailto URLs, normalised', () => {
    expect(safeHref('https://www.vesen.app')).toBe('https://www.vesen.app/');
    expect(safeHref('http://example.com/a?b=1#c')).toBe('http://example.com/a?b=1#c');
    expect(safeHref('mailto:has@salvesen.app')).toBe('mailto:has@salvesen.app');
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox',
    'file:///etc/passwd',
    '/relative/path',
    '//example.com',
    'https://exa mple.com',
    'https://example.com/\n',
    ' https://example.com',
    '',
  ])('rejects %j', (url) => {
    expect(safeHref(url)).toBeNull();
  });
});

describe('span builders', () => {
  it('span carries text and an optional style', () => {
    expect(out.span('hi')).toEqual({ text: 'hi' });
    expect(out.span('hi', { fg: 'accent', bold: true })).toEqual({ text: 'hi', style: { fg: 'accent', bold: true } });
  });

  it('run makes a tappable span with a trusted, frozen run action', () => {
    const s = out.run('ls', 'ls -la', { fg: 'cyan' });
    expect(s.text).toBe('ls');
    expect(s.style).toEqual({ fg: 'cyan' });
    expect(s.action).toMatchObject({ kind: 'run', line: 'ls -la' });
    expect(isTrustedAction(s.action)).toBe(true);
    expect(Object.isFrozen(s.action)).toBe(true);
  });

  it('insert makes a trusted insert action', () => {
    const s = out.insert('cd documents/', 'cd documents/');
    expect(s.action).toMatchObject({ kind: 'insert', text: 'cd documents/' });
    expect(isTrustedAction(s.action)).toBe(true);
  });

  it.each(['ls\nrm -rf ~', 'ls\rrm', 'echo \u0007', 'echo \u001b[31m', 'ls\u2028rm', 'cat \u202egnp.exe', 'a\u0085b'])(
    'run and insert refuse a line that would not read as it runs: %j',
    (line) => {
      expect(() => out.run('x', line)).toThrow(TypeError);
      expect(() => out.insert('x', line)).toThrow(TypeError);
      expect(() => out.action.run(line)).toThrow(TypeError);
    },
  );

  it('allows a tab inside a line to run', () => {
    expect(out.run('x', 'echo a\tb').action).toMatchObject({ line: 'echo a\tb' });
  });

  it('link keeps http, https and mailto hrefs and drops anything else', () => {
    expect(out.link('repo', 'https://github.com/hsalvesen/vesen')).toEqual({
      text: 'repo',
      href: 'https://github.com/hsalvesen/vesen',
    });
    expect(out.link('mail', 'mailto:has@salvesen.app').href).toBe('mailto:has@salvesen.app');
    const unsafe = out.link('click', 'javascript:alert(1)');
    expect(unsafe).toEqual({ text: 'click' });
    expect('href' in unsafe).toBe(false);
  });

  it('link never carries an action', () => {
    expect(out.link('x', 'https://example.com').action).toBeUndefined();
  });

  it('copy, open and share make trusted actions', () => {
    const copy = out.copy('Copy', 'has@salvesen.app');
    expect(copy.action).toMatchObject({ kind: 'copy', text: 'has@salvesen.app' });
    const open = out.open('LinkedIn', 'https://www.linkedin.com/in/example');
    expect(open.action).toMatchObject({ kind: 'open', href: 'https://www.linkedin.com/in/example' });
    const share = out.share('Share', 'https://www.vesen.app', 'vesen');
    expect(share.action).toMatchObject({ kind: 'share', url: 'https://www.vesen.app/', title: 'vesen' });
    for (const s of [copy, open, share]) expect(isTrustedAction(s.action)).toBe(true);
  });

  it('copy keeps multi-line text, which is data rather than a command', () => {
    expect(out.action.copy('a\nb', 'two lines')).toMatchObject({ kind: 'copy', text: 'a\nb', label: 'two lines' });
  });

  it('open and share refuse unsafe URLs', () => {
    expect(() => out.open('x', 'javascript:alert(1)')).toThrow(TypeError);
    expect(() => out.share('x', 'data:text/plain,hi')).toThrow(TypeError);
    expect(() => out.action.open('/relative')).toThrow(TypeError);
  });
});

describe('action trust', () => {
  it('cannot be forged with an object literal at compile time', () => {
    // @ts-expect-error an Action needs the builders' brand
    const forged: Action = { kind: 'run', line: 'rm -rf ~' };
    expect(isTrustedAction(forged)).toBe(false);
  });

  it('is lost by copying, spreading or a JSON round trip', () => {
    const action = out.action.run('ls');
    expect(isTrustedAction(action)).toBe(true);
    expect(isTrustedAction({ ...action })).toBe(false);
    expect(isTrustedAction(JSON.parse(JSON.stringify(action)))).toBe(false);
    expect(isTrustedAction(structuredClone(action))).toBe(false);
  });

  it('rejects non-objects', () => {
    for (const value of [null, undefined, 'run', 1, true]) expect(isTrustedAction(value)).toBe(false);
  });

  it('chips accept only trusted actions', () => {
    const block = out.chips([{ label: 'cd x', action: out.action.run('cd x') }], 'next');
    expect(block).toMatchObject({ type: 'chips', label: 'next', items: [{ label: 'cd x' }] });
    const forged = { kind: 'run', line: 'rm -rf ~' } as unknown as Action;
    expect(() => out.chips([{ label: 'tap me', action: forged }])).toThrow(/untrusted action/);
  });

  it('chips accept the action from a builder span', () => {
    const { text, action } = out.insert('theme set ', 'theme set ');
    if (action === undefined) throw new Error('missing action');
    expect(() => out.chips([{ label: text, action }])).not.toThrow();
  });
});

describe('block builders', () => {
  it('text splits on newlines like a terminal prints them', () => {
    expect(out.text('a\nb').lines).toEqual([[{ text: 'a' }], [{ text: 'b' }]]);
    expect(out.text('a\n').lines).toEqual([[{ text: 'a' }]]);
    expect(out.text('a\n\nb').lines).toEqual([[{ text: 'a' }], [], [{ text: 'b' }]]);
    expect(out.text('\n').lines).toEqual([[]]);
    expect(out.text('').lines).toEqual([]);
    expect(out.text('x', { fg: 'error' }, 'stderr')).toEqual({
      type: 'lines',
      lines: [[{ text: 'x', style: { fg: 'error' } }]],
      stream: 'stderr',
    });
  });

  it('builds every block with its type tag and defaults', () => {
    expect(out.lines([[out.span('a')]])).toEqual({ type: 'lines', lines: [[{ text: 'a' }]], stream: 'stdout' });
    expect(out.grid([out.span('a')], 12)).toEqual({ type: 'grid', items: [{ text: 'a' }], minCh: 12 });
    expect(out.grid([])).toEqual({ type: 'grid', items: [] });
    expect(out.table([[[out.span('a')]]], { align: ['r'] })).toEqual({
      type: 'table',
      rows: [[[{ text: 'a' }]]],
      align: ['r'],
    });
    expect(out.art('##', 'a square')).toEqual({ type: 'art', text: '##', alt: 'a square', fit: 'scale' });
    expect(out.art('##', 'a square', 'scroll', { fg: 'green' })).toMatchObject({ fit: 'scroll', style: { fg: 'green' } });
    expect(out.panel('warn', [[out.span('b')]], 'Note')).toEqual({
      type: 'panel',
      tone: 'warn',
      title: 'Note',
      body: [[{ text: 'b' }]],
    });
    expect(out.columns([], [], 60)).toEqual({ type: 'columns', left: [], right: [], stackBelowCols: 60 });
    expect(out.component('qr-card', { size: 21 }, 'qr', 'A QR code')).toEqual({
      type: 'component',
      name: 'qr-card',
      props: { size: 21 },
      plain: 'qr',
      alt: 'A QR code',
    });
    expect(out.legacyHtml('<b>x</b>')).toEqual({ type: 'legacyHtml', html: '<b>x</b>' });
  });

  it('card checks its href and normalises it', () => {
    expect(out.card({ title: 'vesen', href: 'https://www.vesen.app' })).toEqual({
      type: 'card',
      title: 'vesen',
      href: 'https://www.vesen.app/',
    });
    expect(() => out.card({ title: 'x', href: 'javascript:alert(1)' })).toThrow(TypeError);
  });

  it('lists only the component names the contract allows', () => {
    expect(COMPONENT_NAMES).toEqual(['weather-card', 'quote-card', 'quote-table', 'qr-card', 'link-card']);
  });
});

describe('plain', () => {
  const samples: Record<BlockType, Block> = {
    lines: out.lines([[out.span('total 2', { dim: true })], [out.run('docs/', 'cd docs/'), out.span(' and more')]]),
    grid: out.grid([out.span('README.md'), out.run('documents/', 'cd documents/'), out.span('projects/')]),
    table: out.table(
      [
        [[out.span('AAPL')], [out.span('189.84')]],
        [[out.span('CBA.AX')], [out.span('7.1')]],
      ],
      { head: [[out.span('Symbol')], [out.span('Price')]], align: ['l', 'r'] },
    ),
    art: out.art(' _ \n|_|', 'a box'),
    panel: out.panel('accent', [[out.span('  -a, --all   do not ignore entries starting with .')]], 'ls'),
    chips: out.chips([{ label: 'ls', action: out.action.run('ls') }], 'Try'),
    card: out.card({ title: 'LinkedIn', href: 'https://www.linkedin.com/in/example', detail: 'Opens in a new tab' }),
    columns: out.columns([out.art('logo', 'logo')], [out.text('OS: macOS\nHost: Mac')], 60),
    component: out.component('weather-card', { place: 'Oslo' }, 'Oslo: 9 °C, light rain', 'Weather for Oslo'),
    legacyHtml: out.legacyHtml('<div style="color: red">a &amp; b</div><br><span>c</span>'),
  };

  it.each(Object.entries(samples))('%s is empty or newline-terminated, with no markup', (_type, block) => {
    const text = plain(block);
    expect(text === '' || text.endsWith('\n')).toBe(true);
    expect(text).not.toMatch(/<[a-z/]/i);
    expect(text).not.toContain('\u001b');
  });

  it('lines joins span text and ends each line', () => {
    expect(plain(samples.lines)).toBe('total 2\ndocs/ and more\n');
    expect(plain(out.lines([]))).toBe('');
    expect(plain(out.lines([[], [out.span('x')]]))).toBe('\nx\n');
  });

  it('round-trips text written with out.text', () => {
    for (const text of ['a\n', 'a\nb\n', '\n', 'a\n\n\nb\n', '']) expect(plain(out.text(text))).toBe(text);
    expect(plain(out.text('no newline'))).toBe('no newline\n');
  });

  it('grid prints one item per line, as ls does into a pipe', () => {
    expect(plain(samples.grid)).toBe('README.md\ndocuments/\nprojects/\n');
  });

  it('table pads columns, aligns them and trims trailing space', () => {
    expect(plain(samples.table)).toBe('Symbol   Price\nAAPL    189.84\nCBA.AX     7.1\n');
    const ragged = out.table([[[out.span('a')], [out.span('b')]], [[out.span('long')]]]);
    expect(plain(ragged)).toBe('a     b\nlong\n');
  });

  it('table measures width in terminal cells, not UTF-16 units', () => {
    expect(textWidth('°C')).toBe(2);
    expect(textWidth('Tāmaki')).toBe(6);
    const table = out.table([
      [[out.span('🌧')], [out.span('x')]],
      [[out.span('ab')], [out.span('y')]],
    ]);
    expect(plain(table)).toBe('🌧  x\nab  y\n');
  });

  it('counts East Asian wide characters and emoji as two cells, and combining marks as none', () => {
    expect(textWidth('東京')).toBe(4);
    expect(textWidth('🦘x')).toBe(3);
    expect(textWidth('🌧x')).toBe(3);
    expect(textWidth('한글')).toBe(4);
    expect(textWidth('ｶﾀｶﾅ')).toBe(4);
    expect(textWidth('a\u0301')).toBe(1);
    expect(textWidth('a\u200bb')).toBe(2);
    expect(charWidth('東')).toBe(2);
    expect(charWidth('\u0301')).toBe(0);
  });

  it('art keeps its shape', () => {
    expect(plain(samples.art)).toBe(' _ \n|_|\n');
    expect(plain(out.art('x\n', 'x'))).toBe('x\n');
  });

  it('panel prints its title, then its body', () => {
    expect(plain(samples.panel)).toBe('ls\n  -a, --all   do not ignore entries starting with .\n');
    expect(plain(out.panel('error', [[out.span('oops')]]))).toBe('oops\n');
  });

  it('chips are interactive only and give a pipe nothing', () => {
    expect(plain(samples.chips)).toBe('');
  });

  it('card prints its title, URL and detail', () => {
    expect(plain(samples.card)).toBe('LinkedIn\nhttps://www.linkedin.com/in/example\nOpens in a new tab\n');
    expect(plain(out.card({ title: 'Email', href: 'mailto:has@salvesen.app', copy: 'has@salvesen.app' }))).toBe(
      'Email\nmailto:has@salvesen.app\n',
    );
  });

  it('columns stack the left side above the right, recursively', () => {
    expect(plain(samples.columns)).toBe('logo\nOS: macOS\nHost: Mac\n');
    const nested = out.columns([samples.columns], [out.text('end')], 40);
    expect(plain(nested)).toBe('logo\nOS: macOS\nHost: Mac\nend\n');
  });

  it("component blocks give a pipe their plain text, never their props or alt", () => {
    const text = plain(samples.component);
    expect(text).toBe('Oslo: 9 °C, light rain\n');
    expect(text).not.toContain('Weather for Oslo');
    expect(text).not.toContain('place');
    expect(plain(out.component('qr-card', {}, 'line 1\nline 2\n', 'qr'))).toBe('line 1\nline 2\n');
    expect(plain(out.component('link-card', {}, '', 'nothing'))).toBe('');
  });

  it('legacy HTML is read as text', () => {
    expect(plain(samples.legacyHtml)).toBe('a & b\n\nc\n');
    expect(plain(out.legacyHtml('<span>&lt;stdio.h&gt;</span>'))).toBe('<stdio.h>\n');
    expect(plain(out.legacyHtml(''))).toBe('');
  });

  it('drops styles, links and actions but keeps their text', () => {
    const line = [out.span('see ', { bold: true }), out.link('repo', 'https://example.com'), out.copy(' [copy]', 'x')];
    expect(lineText(line)).toBe('see repo [copy]');
    expect(plain(out.lines([line]))).toBe('see repo [copy]\n');
  });

  it('uses span text for live bindings', () => {
    const live = { ...out.run('swamphen', 'theme set swamphen'), live: { kind: 'isCurrentTheme', theme: 'swamphen' } } as const;
    expect(plain(out.grid([live]))).toBe('swamphen\n');
  });
});

describe('swatches, markers and grid notes', () => {
  it('swatches checks every colour, and gives a pipe its blocks of text', () => {
    const strip = out.swatches('#222235', ['#FFFFFF', '#f60055']);
    expect(strip.swatches).toEqual({ background: '#222235', colours: ['#ffffff', '#f60055'] });
    expect(strip.text).toBe(' ████ ');
    expect(plain(out.lines([[strip]]))).toBe(' ████ \n');
    expect(() => out.swatches('red', [])).toThrow(TypeError);
    expect(() => out.swatches('#000000', ['url(x)'])).toThrow(TypeError);
    expect(hexColour('#ABCDEF')).toBe('#abcdef');
    expect(hexColour('#abc')).toBeNull();
  });

  it('live makes a span the renderer reads from the stores, which a pipe reads as written', () => {
    const marker = out.live('› ', { kind: 'isCurrentTheme', theme: 'wombat', marker: '› ' }, { fg: 'accent' });
    expect(marker).toEqual({ text: '› ', style: { fg: 'accent' }, live: { kind: 'isCurrentTheme', theme: 'wombat', marker: '› ' } });
    expect(lineText([marker, out.span('wombat')])).toBe('› wombat');
  });

  it('grid notes line up after their items in a pipe', () => {
    const grid = out.grid([out.span('ls'), out.span('mkdir'), out.span('cd')], 40, [[out.span('list')], [out.span('make')], []]);
    expect(grid).toMatchObject({ type: 'grid', minCh: 40, notes: [[{ text: 'list' }], [{ text: 'make' }], []] });
    expect(plain(grid)).toBe('ls     list\nmkdir  make\ncd\n');
    expect(out.grid([out.span('a')])).toEqual({ type: 'grid', items: [{ text: 'a' }] });
  });
});
