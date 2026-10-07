// qr as a visitor types it: a qr-card block on the terminal, text art into a pipe, Present mode
// with -f, and every error in its own words.
import { describe, expect, it, vi } from 'vitest';
import { runLine, type LineResult } from '../../../tests/harness';
import { encodeText, QrCapacityError, toText, type QrView } from '../../lib/qr';
import type { ComponentBlock } from '../../output/model';
import { groupThousands, tooLongMessage } from './qr.run';

function card(result: LineResult): ComponentBlock {
  const blocks = result.blocks.filter((block): block is ComponentBlock => block.type === 'component');
  expect(blocks).toHaveLength(1);
  expect(blocks[0]!.name).toBe('qr-card');
  return blocks[0]!;
}

const viewOf = (result: LineResult): QrView => card(result).props as QrView;

const TRY = "Try 'qr --help' for more information.";

describe('qr on the terminal', () => {
  it('draws vesen.app as a card for https://vesen.app, its level raised for free', async () => {
    const result = await runLine('qr vesen.app');
    expect(result.status).toBe(0);
    const block = card(result);
    const view = block.props as QrView;
    expect(view).toMatchObject({
      payload: 'https://vesen.app',
      kind: 'link',
      version: 2,
      size: 25,
      ecc: 'Q',
      requestedEcc: 'M',
      bytes: 17,
      capacity: 22,
      note: 'added https:// · --text encodes exactly what you typed',
      tips: [],
      options: { type: 'svg', size: 'fit', margin: 4, fullscreen: false },
    });
    expect(view.modules).toEqual(encodeText('https://vesen.app', { ecc: 'M', boostEcc: true }).modules);
    expect(block.alt).toBe('QR code for https://vesen.app');
    // What a pipe would receive: half-block art with a 2-module quiet zone.
    expect(block.plain).toBe(`${toText(view, { style: 'utf8', margin: 2 }).join('\n')}\n`);
  });

  it('keeps the level -e asks for', async () => {
    expect(viewOf(await runLine('qr -e M vesen.app'))).toMatchObject({ ecc: 'M', requestedEcc: 'M' });
    expect(viewOf(await runLine('qr -e L vesen.app'))).toMatchObject({ ecc: 'L', version: 1 });
  });

  it('passes the options on to the card', async () => {
    const view = viewOf(await runLine('qr -s 12 -m 2 -v 5 --mask 3 -8 hello'));
    expect(view).toMatchObject({ version: 5, mask: 3, options: { type: 'svg', size: 12, margin: 2 } });
    expect(view.tips).toEqual(['note: quiet zones this small may not scan.']);
  });

  it('draws text art with -t, and warns about inverted art', async () => {
    const utf8 = card(await runLine('qr -t utf8 hello'));
    expect((utf8.props as QrView).options).toMatchObject({ type: 'utf8', margin: 2 });
    expect(utf8.plain).toBe(`${toText(utf8.props as QrView, { style: 'utf8', margin: 2 }).join('\n')}\n`);
    const inverted = viewOf(await runLine('qr -t utf8i hello'));
    expect(inverted.tips).toEqual(["note: inverted codes don't scan on every phone."]);
    expect(card(await runLine('qr -t ascii hi')).plain).toMatch(/^[# \n]+$/);
  });

  it('encodes markup as text, which the card draws as text', async () => {
    const view = viewOf(await runLine("qr '<u>x</u>'"));
    expect(view).toMatchObject({ payload: '<u>x</u>', kind: 'text' });
  });

  it('says what an email address, a phone number or a file name could be', async () => {
    expect(viewOf(await runLine('qr has@salvesen.app')).tips).toEqual(['tip: use qr mailto:has@salvesen.app for a tap-to-email code']);
    expect(viewOf(await runLine("qr '+61 412 345 678'")).tips).toEqual(['tip: use qr tel:+61412345678 for a tap-to-call code']);
    expect(viewOf(await runLine('qr README.md'))).toMatchObject({
      payload: 'README.md',
      kind: 'text',
      tips: ['tip: README.md is a file here; this code contains the name, not the contents'],
    });
  });

  it('joins its words with spaces, and reads text after --', async () => {
    expect(viewOf(await runLine('qr hello world')).payload).toBe('hello world');
    expect(viewOf(await runLine('qr -- -5°C')).payload).toBe('-5°C');
  });

  it('encodes what is piped in, less its last newline', async () => {
    expect(viewOf(await runLine('echo vesen.app | qr')).payload).toBe('https://vesen.app');
    expect(viewOf(await runLine("printf 'a\\nb\\n' | qr")).payload).toBe('a\nb');
  });

  it('shows its help when run bare or with --help or -h', async () => {
    for (const line of ['qr', 'qr --help', 'qr -h', 'qr x -h']) {
      const result = await runLine(line);
      expect(result.status, line).toBe(0);
      expect(result.stdoutPlain, line).toContain('qr [OPTION]... [--] TEXT...');
      expect(result.stdoutPlain, line).toContain('nothing you encode is sent anywhere');
    }
  });

  it('opens Present mode with -f, and finishes when it closes', async () => {
    const fullscreen = vi.fn(() => Promise.resolve(undefined));
    const result = await runLine('qr -f vesen.app', { fullscreen });
    expect(result.status).toBe(0);
    expect(fullscreen).toHaveBeenCalledTimes(1);
    expect(fullscreen).toHaveBeenCalledWith('qr-present', viewOf(result), expect.anything());
    expect(viewOf(result).options.fullscreen).toBe(true);
  });

  it('leaves the card when full screen cannot open', async () => {
    const fullscreen = vi.fn(() => Promise.reject(new Error('full-screen apps need the terminal')));
    const result = await runLine('qr -f vesen.app', { fullscreen });
    expect(result.status).toBe(0);
    card(result);
  });
});

describe('qr and privacy', () => {
  it('is listed as made in the browser, sending nothing', async () => {
    expect((await runLine('privacy', { tty: false })).stdoutPlain).toContain('qr makes its codes in your browser: nothing you encode is sent anywhere.');
  });
});

describe('qr into a pipe', () => {
  it('writes the art alone, and its notes to the terminal', async () => {
    const result = await runLine('qr vesen.app', { tty: false });
    expect(result.status).toBe(0);
    expect(result.stdoutPlain).toBe(toText(encodeText('https://vesen.app', { ecc: 'M', boostEcc: true }), { style: 'utf8', margin: 2 }).join('\n'));
    expect(result.stdoutPlain).toMatch(/^[█▀▄ \n]+$/);
    expect(result.stderrPlain).toBe('added https:// · --text encodes exactly what you typed');
  });

  it('writes the style -t asks for', async () => {
    expect((await runLine('qr -t ascii hi', { tty: false })).stdoutPlain).toMatch(/^[# \n]+$/);
  });

  it('never opens full screen', async () => {
    const fullscreen = vi.fn(() => Promise.resolve(undefined));
    const result = await runLine('qr -f x | cat', { fullscreen });
    expect(result.status).toBe(0);
    expect(fullscreen).not.toHaveBeenCalled();
    expect(result.stdoutPlain).toMatch(/^[█▀▄ \n]+$/);
  });
});

describe('qr errors', () => {
  it.each([
    ['qr --sz 3 x', "qr: unknown option '--sz'. Did you mean '--size'?"],
    ['qr -x hi', "qr: unknown option '-x'"],
    ['qr -e X hi', "qr: '-e' needs one of L, M, Q, H (got 'X')"],
    ['qr -s 0 hi', "qr: '-s' needs a number from 1 to 32 or 'fit'"],
    ['qr -m 11 hi', "qr: '-m' needs a number from 0 to 10"],
    ['qr -t png hi', "qr: '-t' needs one of svg, utf8, utf8i, ascii (got 'png')"],
    ['qr -v 41 hi', "qr: '-v' needs a version from 1 to 40"],
    ['qr --mask 9 hi', 'qr: --mask needs a number from 0 to 7'],
    ['qr -e H', 'qr: missing text or link. Try: qr vesen.app'],
    ["qr ''", 'qr: missing text or link. Try: qr vesen.app'],
    ['qr -5°C', "qr: to encode text that starts with '-', put -- first: qr -- -5°C"],
    ['qr --url hello world', "qr: --url needs a link, such as vesen.app (got 'hello world')"],
  ])('%s', async (line, message) => {
    const result = await runLine(line);
    expect(result.status).toBe(1);
    expect(result.stdoutPlain).toBe('');
    expect(result.stderrPlain).toBe(`${message}\n${TRY}`);
    expect(result.blocks.some((block) => block.type === 'component')).toBe(false);
  });

  it('refuses javascript: links', async () => {
    const result = await runLine("qr 'javascript:alert(1)'");
    expect(result).toMatchObject({ status: 1, stdoutPlain: '', stderrPlain: "qr: won't encode javascript: links" });
  });

  it('says how much each level holds when the text is too long', async () => {
    // -8: as bytes, which the spaces would not otherwise be.
    expect(await runLine("printf '%3120s' x | qr -8")).toMatchObject({
      status: 1,
      stdoutPlain: '',
      stderrPlain: 'qr: too long for a QR code (3,120 bytes). Level M holds 2,331 bytes, L holds 2,953. Try -e L or shorter text.',
    });
    expect((await runLine("printf '%3120s' x | qr -8 -e L")).stderrPlain).toBe(
      'qr: too long for a QR code (3,120 bytes). Level L holds 2,953 bytes. Try shorter text.',
    );
    // As letters and spaces it fits: 3,120 alphanumeric characters at level M.
    expect((await runLine("printf '%3120s' X | qr")).status).toBe(0);
  });

  it('words the capacity error for a link', () => {
    const error = new QrCapacityError({ bytes: 3000, needBits: 0, maxBits: 0, ecc: 'H', maxBytes: { L: 2953, M: 2331, Q: 1663, H: 1273 } });
    expect(tooLongMessage(error, 'link')).toBe('too long for a QR code (3,000 bytes). Level H holds 1,273 bytes, L holds 2,953. Try -e L or a shorter link.');
    expect(groupThousands(1234567)).toBe('1,234,567');
    expect(groupThousands(999)).toBe('999');
  });
});
