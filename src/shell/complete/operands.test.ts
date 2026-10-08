// Values from examples and history (ValueSource 'examples'): an operand is what getopt would take
// for one, never the word a flag's value took (`ping -c 10`), nor dig's `+short` and `@google`,
// which stand anywhere. Run with the catalogue in, where ping, host, dig and the others live.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runLine } from '../../../tests/harness';
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

// ip's words choose what follows them (EnumValue.args): its object, then its command, then a
// device or an address. Only `ip route` takes get, and get takes an ADDRESS, never a device.
describe('operands chosen by the word before them', () => {
  const touchChips = (line: string): { label: string; line?: string }[] => {
    const state = at(line);
    const { chips } = chipsFor({ mode: 'edit', state, result: complete(state, env), tab: TAB_IDLE, touch: true, registry: env.registry, history: [], max: 12, env });
    return chips.map((chip) => ({ label: chip.label, ...(chip.line === undefined ? {} : { line: chip.line }) }));
  };
  const runs = (line: string): string[] => touchChips(line).flatMap((chip) => (chip.line === undefined ? [] : [chip.line]));

  it("offers each ip object only the commands it has: get for route alone", () => {
    expect(values('ip ')).toEqual(['addr', 'link', 'route']);
    expect(values('ip addr ')).toEqual(['show']);
    expect(values('ip link ')).toEqual(['show']);
    expect(values('ip route ')).toEqual(['get', 'show']);
    expect(values('ip addr g')).toEqual([]);
    expect(complete(at('ip route '), env).placeholder).toBe('COMMAND');
  });

  it('offers an address after ip route get, and a device after show', () => {
    const get = complete(at('ip route get '), env);
    expect(get.placeholder).toBe('ADDRESS');
    expect(get.candidates.map((c) => c.value)).toEqual(['1.1.1.1', '10.42.0.7']);
    expect(values('ip route get e')).toEqual([]);
    expect(values('ip route show ')).toEqual(['dev', 'eth0', 'lo']);
    expect(values('ip addr show ')).toEqual(['dev', 'eth0', 'lo']);
    expect(values('ip addr show dev ')).toEqual(['eth0', 'lo']);
    expect(complete(at('ip addr show dev '), env).placeholder).toBe('NAME');
    expect(values('ip link show lo ')).toEqual([]);
  });

  it("follows ip's abbreviations and options as ip reads them", () => {
    expect(values('ip a ')).toEqual(['show']);
    expect(values('ip r g ')).toEqual(['1.1.1.1', '10.42.0.7']);
    expect(values('ip a s ')).toEqual(['dev', 'eth0', 'lo']);
    expect(values('ip -4 route ')).toEqual(['get', 'show']);
    expect(values('ip -br link ')).toEqual(['show']);
  });

  it('never puts a line on the phone that ip would refuse', () => {
    expect(runs('ip route get ')).toEqual([]);
    expect(runs('ip route get')).toEqual([]);
    expect(touchChips('ip route get ').map((chip) => chip.label)).toEqual(['1.1.1.1', '10.42.0.7']);
    expect(runs('ip addr ')).toEqual(['ip addr']);
    expect(runs('ip route ')).toEqual(['ip route']);
    expect(runs('ip route show ')).toEqual(['ip route show', 'ip route show eth0', 'ip route show lo']);
    expect(runs('ip addr show dev ')).toEqual(['ip addr show dev eth0', 'ip addr show dev lo']);
    expect(runs('ip ')).toEqual([]);
  });

  it('runs every line those chips offer', async () => {
    for (const line of ['ip route show eth0', 'ip addr show dev lo', 'ip route get 10.42.0.7', 'ip link show']) {
      const { status } = await runLine(line);
      expect(status, line).toBe(0);
    }
  });
});
