// The status line while a network command runs names what it is working on: the operand, never
// the value a flag took (`ping -c 10 -i 0.5 example.com` once said "timing 0.5").
import { describe, expect, it } from 'vitest';
import type { CommandSpec } from '../../../shell/types';
import host from './host';
import ping from './ping';
import wget from './wget';
import whois from './whois';

const label = (spec: CommandSpec, line: string): string => spec.loadingLabel?.(line.split(' ')) ?? '';

describe('network status lines', () => {
  it.each([
    ['ping -c 10 -i 0.5 example.com', ping, 'ping: timing example.com…'],
    ['ping -qc 3 -W 2 vesen.app', ping, 'ping: timing vesen.app…'],
    ['ping -c3 1.1.1.1', ping, 'ping: timing 1.1.1.1…'],
    ['ping localhost', ping, 'ping: timing localhost…'],
    ['ping -c 2', ping, 'ping: timing the host…'],
    ['host -t TXT example.com', host, 'host: looking up example.com…'],
    ['host example.com google', host, 'host: looking up example.com…'],
    ['whois -h whois.example.net vesen.app', whois, 'whois: asking RDAP about vesen.app…'],
    ['whois vesen.app', whois, 'whois: asking RDAP about vesen.app…'],
    ['wget -O page.html https://vesen.app/', wget, 'wget: fetching https://vesen.app/…'],
    ['wget -qO out.txt vesen.app', wget, 'wget: fetching vesen.app…'],
  ])('%s', (line, spec, expected) => {
    expect(label(spec, line)).toBe(expected);
  });
});
