// The body of debug: builds the report, copies it, and prints it.

import { out, type Line } from '../../output/model';
import type { CommandContext, ExitCode } from '../../shell/types';

const ISSUES = 'https://github.com/hsalvesen/vesen/issues';

/** The report as plain text, one `name: value` per line. */
export function debugReport(ctx: Pick<CommandContext, 'sys' | 'tty' | 'appearance' | 'clock'>): string {
  const snap = ctx.sys.snapshot();
  const diag = ctx.sys.diagnostics();
  const tier = ctx.appearance.cathodeTier();
  const { viewport, errors } = diag;
  const visible = viewport.visibleHeight === null ? '' : ` (visible ${Math.round(viewport.visibleHeight)}, scale ${viewport.scale ?? 1})`;
  const rows: [string, string][] = [
    ['build', __APP_VERSION__],
    ['time', new Date(ctx.clock.now()).toISOString()],
    ['agent', snap.userAgent || 'unknown'],
    ['in-app', ctx.tty.inApp ?? 'no'],
    ['touch', ctx.tty.touch ? 'yes' : 'no'],
    ['viewport', `${viewport.width}x${viewport.height}${visible}`],
    ['screen', `${snap.screen.width}x${snap.screen.height} @${snap.screen.pixelRatio}x`],
    ['terminal', `${ctx.tty.columns}x${ctx.tty.rows}`],
    ['crt', `${tier.tier} (${tier.reason})`],
    ['online', diag.online ? 'yes' : 'no'],
    ['home screen', diag.standalone ? 'yes' : 'no'],
    ['errors', errors.length === 0 ? 'none' : String(errors.length)],
  ];
  const width = Math.max(...rows.map(([name]) => name.length)) + 1;
  return [
    'vesen debug report',
    ...rows.map(([name, value]) => `${`${name}:`.padEnd(width)} ${value}`),
    ...errors.map((error) => `  ${error}`),
  ].join('\n');
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  if (ctx.sub !== 'report') {
    const [word] = ctx.args;
    return ctx.usage(word === undefined ? "a subcommand is required: 'debug report'" : `unknown subcommand '${word}'`);
  }
  const [extra] = ctx.args;
  if (extra !== undefined) return ctx.usage(`extra operand '${extra}'`);
  const report = debugReport(ctx);
  if (!ctx.stdout.isTTY) {
    await ctx.stdout.write(`${report}\n`);
    return 0;
  }
  const copied = await ctx.tty.copy(report);
  await ctx.stdout.block(out.panel('muted', report.split('\n').map((row): Line => [out.span(row)])));
  if (copied) {
    await ctx.stdout.line(out.span('✓ Copied. Paste it into an issue: ', { fg: 'ok' }), out.link('github.com/hsalvesen/vesen/issues', ISSUES));
  } else {
    await ctx.stdout.line(out.span('Could not copy without a tap here: tap Copy report, or select the text above.', { fg: 'warn' }));
    await ctx.stdout.block(out.chips([{ label: '⧉ Copy report', action: out.action.copy(report, 'Copy report') }]));
  }
  return 0;
}
