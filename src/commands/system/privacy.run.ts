// The body of privacy: the table of third parties, then what stays in this browser.

import { out, type Line } from '../../output/model';
import type { CommandContext, CommandDoc, ExitCode } from '../../shell/types';
import { isLegacySpec } from '../legacy';

/** What --help, help and man say about privacy, besides its spec (privacy.ts). */
export const doc: CommandDoc = {
  description: 'Each service a command talks to, and what it is sent. IP and location lookups happen only on request.',
};

interface ThirdParty {
  readonly service: string;
  /** The commands that talk to it. */
  readonly commands: readonly string[];
  /** Who asks, as the table says it. */
  readonly askedBy: string;
  readonly sent: string;
  /** What a legacy command uses until it is ported: shown only while one of `commands` is legacy. */
  readonly legacy?: boolean;
}

export const THIRD_PARTIES: readonly ThirdParty[] = [
  { service: 'Open-Meteo', commands: ['weather'], askedBy: 'weather', sent: 'the place you name, or its coordinates' },
  { service: 'OpenStreetMap Nominatim', commands: ['weather'], askedBy: 'weather', sent: 'a place Open-Meteo cannot find, or coordinates to name' },
  {
    service: 'GeoJS, then ipinfo.io',
    commands: ['weather'],
    askedBy: 'weather with no place',
    sent: 'nothing but the request: they answer with your approximate location',
  },
  { service: "vesen's stock Worker", commands: ['stock'], askedBy: 'stock', sent: 'the ticker' },
  { service: 'Cloudflare speed test', commands: ['speedtest'], askedBy: 'speedtest', sent: 'test data, down and up' },
  { service: 'Cloudflare or Google DNS-over-HTTPS', commands: ['dig', 'host', 'nslookup'], askedBy: 'dig, host, nslookup', sent: 'the name you look up' },
  { service: 'RDAP (rdap.org and the registries)', commands: ['whois'], askedBy: 'whois', sent: 'the domain you look up' },
  { service: 'GitHub', commands: ['git', 'repo'], askedBy: 'git log in ~/projects/vesen', sent: 'nothing but the request' },
  { service: 'ipify', commands: ['fastfetch'], askedBy: 'fastfetch', sent: 'nothing but the request: it answers with your public IP' },
  // What the legacy commands use until their ports land.
  { service: 'wttr.in', commands: ['weather'], askedBy: 'weather, for now', sent: 'the place you name', legacy: true },
  { service: 'allorigins.win, then Yahoo Finance', commands: ['stock'], askedBy: 'stock, for now', sent: 'the ticker', legacy: true },
];

const NOTES: readonly string[] = [
  'Every request carries your IP address, as any web request does. Nothing else you type is sent, except as listed.',
  "IP address and location lookups happen only on request: weather with no place, and fastfetch's Public IP.",
  'curl and wget fetch the address you give them, straight from your browser.',
  'qr makes its codes in your browser: nothing you encode is sent anywhere.',
  'Links open only when you tap them, or in a desktop browser when whoami, linkedin, repo or open opens one.',
  'This browser keeps the theme, your settings, history and your files under ~ (local storage), and a snapshot of the screen for Back for 30 minutes (session storage). What you type at sudo is never kept.',
  'No analytics, and no cookies.',
];

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const [extra] = ctx.args;
  if (extra !== undefined) return ctx.usage(`extra operand '${extra}'`);
  const registry = ctx.shell.registry;
  const shown = THIRD_PARTIES.filter(
    (row) => row.legacy !== true || row.commands.some((name) => {
      const spec = registry.get(name);
      return spec !== undefined && isLegacySpec(spec);
    }),
  );
  const cell = (text: string): Line => [out.span(text)];
  await ctx.stdout.block(out.lines([[out.span('What vesen sends, and where', { fg: 'accent', bold: true })], []]));
  await ctx.stdout.block(
    out.table(
      shown.map((row) => [[out.span(row.service, { fg: 'fg-strong' })], cell(row.askedBy), cell(row.sent)]),
      { head: [cell('Service'), cell('Asked by'), cell('What it is sent')], stackBelowCols: 100 },
    ),
  );
  await ctx.stdout.block(out.lines([[], ...NOTES.map((note): Line => [out.span(`• ${note}`)])]));
  return 0;
}
