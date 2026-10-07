// The bodies of poweroff, reboot and shutdown: systemd's lines go to the Shutdown app
// (ctx.tty.fullscreen), which fades to '● vesen is off' and waits for Power on (or, for a reboot,
// comes straight back); then a new login session starts with the banner, files and history kept.

import type { ShutdownView } from '../../shell/shutdown';
import type { CommandContext, ExitCode } from '../../shell/types';

const OK = '[  OK  ]';
const PAD = ' '.repeat(OK.length);

/** What systemd prints on the way down, in vesen's words. */
export function shutdownLines(kind: ShutdownView['kind'], user: string): string[] {
  return [
    `${PAD} Stopping vesen shell session for ${user}...`,
    `${OK} Stopped vesen shell session for ${user}.`,
    `${OK} Stopped target Graphical Interface.`,
    `${OK} Stopped Cathode Ray Tube Display.`,
    `${OK} Stopped target Network.`,
    `${OK} Unmounted /home/${user} (your files are kept).`,
    `${OK} Reached target System Shutdown.`,
    kind === 'reboot' ? `${OK} Reached target System Reboot.` : `${OK} Reached target System Power Off.`,
    kind === 'reboot' ? 'reboot: Restarting system' : 'reboot: Power down',
  ];
}

async function powerDown(ctx: CommandContext, kind: ShutdownView['kind']): Promise<ExitCode> {
  const view: ShutdownView = { kind, lines: shutdownLines(kind, ctx.user.name), inApp: ctx.tty.inApp !== null, touch: ctx.tty.touch };
  // Until Power on, or the reboot coming back; ^C ends it and the prompt returns.
  await ctx.tty.fullscreen<string>('shutdown', view);
  await ctx.shell.login({ banner: true });
  return 0;
}

export async function poweroff(ctx: CommandContext): Promise<ExitCode> {
  const [extra] = ctx.args;
  if (extra !== undefined) return ctx.usage(`extra operand '${extra}'`);
  return powerDown(ctx, 'poweroff');
}

export async function reboot(ctx: CommandContext): Promise<ExitCode> {
  const [extra] = ctx.args;
  if (extra !== undefined) return ctx.usage(`extra operand '${extra}'`);
  return powerDown(ctx, 'reboot');
}

export async function shutdown(ctx: CommandContext): Promise<ExitCode> {
  const [time, extra] = ctx.args;
  if (extra !== undefined) return ctx.usage(`extra operand '${extra}'`);
  if (time !== undefined && time !== 'now' && time !== '+0') {
    return ctx.fail(`scheduled shutdowns are not supported; try 'shutdown now'`);
  }
  return powerDown(ctx, ctx.opts.reboot === true ? 'reboot' : 'poweroff');
}
