// Values from examples and history (ValueSource 'examples'): an operand is what getopt would take
// for one, never the word a flag's value took (`ping -c 10`), nor dig's `+short` and `@google`,
// which stand anywhere. Run with the catalogue in, where ping, host, dig and the others live.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { at, completionHarness, type CompletionHarness } from '../../testing/completion-env';
import { chipsFor } from './chips';
import { operandsOf } from './context';
import { complete } from './engine';
import { TAB_IDLE, type CompletionEnv } from './types';

let h: CompletionHarness;
let env: CompletionEnv;

beforeAll(async () => {
  h = await completionHarness();
  env = h.env;
  await h.app.shell.registry.whenComplete();
});
afterAll(() => h.stop());

const values = (line: string): string[] => complete(at(line), env).candidates.map((c) => c.value);
const notes = (line: string): Record<string, string | undefined> =>
  Object.fromEntries(complete(at(line), env).candidates.map((c) => [c.value, c.summary]));

describe('operands from examples', () => {
  it("skips the value a flag takes: ping's -c 10 is not a host", () => {
    expect(values('ping ')).toEqual(['example.com', 'vesen.app']);
    expect(values('ping 1')).toEqual([]);
  });

  it("skips host's -t TXT", () => {
    expect(values('host ')).toEqual(['1.1.1.1', 'example.com', 'localhost', 'vesen.app']);
    expect(values('host T')).toEqual([]);
  });

  it("skips dig's -x ADDR, +options and @server, wherever they stand", () => {
    expect(values('dig ')).toEqual(['example.com', 'localhost', 'vesen.app', 'www.github.com']);
    for (const line of ['dig +short ', 'dig @google ', 'dig +noall +answer ']) {
      const result = complete(at(line), env);
      expect(result.placeholder, line).toBe('NAME');
      expect(result.candidates.map((c) => c.value), line).toEqual(['example.com', 'localhost', 'vesen.app', 'www.github.com']);
    }
    expect(complete(at('dig +short vesen.app '), env).placeholder).toBe('TYPE');
    expect(complete(at('dig @google vesen.app MX '), env).placeholder).toBe('OPTION');
  });

  it('offers dig its +options and servers for a word that starts with + or @', () => {
    expect(values('dig +')).toEqual(['+answer', '+noall', '+short']);
    expect(values('dig vesen.app @')).toEqual(['@cloudflare', '@google']);
  });

  it("keeps qr's text whole after -e H and -t utf8", () => {
    expect(values('qr ')).toEqual(['explainshell.com', 'hello', 'https://tldr.sh', 'mailto:has@salvesen.app', 'vesen.app']);
  });

  it('gives a value the note of an example only when that example is the value alone', () => {
    expect(notes('ping ')).toEqual({ 'example.com': undefined, 'vesen.app': 'four requests, a second apart' });
    expect(notes('host ')['1.1.1.1']).toBe('the name of an address');
    expect(notes('host ')['example.com']).toBeUndefined();
    // `nslookup example.com google` asks Google; example.com alone does not.
    expect(notes('nslookup ')['example.com']).toBeUndefined();
    expect(notes('qr ')).toMatchObject({ 'mailto:has@salvesen.app': undefined, hello: undefined, 'vesen.app': 'share this terminal' });
  });

  it("puts no flag's value on the phone's chips", () => {
    const state = at('ping ');
    const { chips } = chipsFor({ mode: 'edit', state, result: complete(state, env), tab: TAB_IDLE, touch: true, registry: env.registry, history: [], max: 12 });
    expect(chips.map((c) => c.label)).toEqual(['example.com', 'vesen.app']);
  });

  it('never offers a flag, a flag value or a marked word from any example, in any command', () => {
    for (const spec of env.registry.list({ includeHidden: true })) {
      const args = spec.args ?? [];
      args.forEach((arg, index) => {
        if (arg.source.kind !== 'examples') return;
        const offered = new Set(values(`${spec.name} ${'x '.repeat(index)}`));
        for (const example of spec.examples ?? []) {
          const words = example.line.split(/\s+/).slice(1);
          const { operands } = operandsOf(words, spec);
          for (const word of words) {
            if (operands.includes(word)) continue;
            expect(offered.has(word), `${spec.name}: '${word}' from '${example.line}'`).toBe(false);
          }
        }
      });
    }
  });
});

describe('operands from history', () => {
  it('skips the values flags took on lines typed earlier', () => {
    h.app.shell.remember('ping -c 3 history.example');
    h.app.shell.remember('ping -W 2 -c5 attached.example');
    h.app.shell.remember('host -t MX -- mail.example');
    h.app.shell.remember('weather --days 5 Hobart');
    h.app.shell.remember('qr -- -x');
    expect(values('ping ')).toEqual(['attached.example', 'example.com', 'history.example', 'vesen.app']);
    expect(values('host m')).toEqual(['mail.example']);
    expect(values('weather H')).toEqual(['Hobart']);
    // A value that looks like an option would be one where it lands.
    expect(values('qr ')).not.toContain('-x');
  });
});

describe('operandsOf', () => {
  it('reads the words as getopt would', () => {
    const ping = env.registry.get('ping');
    expect(ping).toBeDefined();
    if (ping === undefined) return;
    expect(operandsOf(['-c', '10', '-i', '0.5', 'example.com'], ping)).toEqual({ operands: ['example.com'], all: false });
    expect(operandsOf(['-qc', '2', 'a.example'], ping)).toEqual({ operands: ['a.example'], all: false });
    expect(operandsOf(['-c2', 'a.example'], ping)).toEqual({ operands: ['a.example'], all: false });
    expect(operandsOf(['--', '-c', 'a.example'], ping)).toEqual({ operands: ['-c', 'a.example'], all: false });
    expect(operandsOf(['a.example'], ping)).toEqual({ operands: ['a.example'], all: true });
    const qr = env.registry.get('qr');
    if (qr === undefined) return;
    expect(operandsOf(['--ec=H', '--type', 'utf8', 'hi'], qr).operands).toEqual(['hi']);
  });
});
