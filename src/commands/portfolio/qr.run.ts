// The body of qr; its spec, in qr.ts, loads this (and the encoder with it) the first time qr runs.
// Words → options (lib/qr-args) → what to encode (lib/qr-payload) → the symbol (lib/qr) → a
// `qr-card` block on the terminal, whose plain text, text art, is what a pipe or a file receives.

import {
  displayPayload,
  encodeText,
  QrCapacityError,
  toText,
  type EccLevel,
  type QrSymbol,
  type QrView,
} from '../../lib/qr';
import { out, type SpanStyle } from '../../output/model';
import type { CommandContext, CommandDoc, ExitCode } from '../../shell/types';
import { parseQrArgs, type QrArgs } from '../lib/qr-args';
import { classifyPayload, type Payload } from '../lib/qr-payload';

/** What --help, help and man say about qr, besides its spec (qr.ts). */
export const doc: CommandDoc = {
  description:
    "Draws a QR code for TEXT, the words joined by spaces, or for what is piped in. The code is made in your browser: nothing you encode is sent anywhere. A bare host such as vesen.app becomes https://vesen.app; --text encodes exactly what you typed. Click or tap a code to show it full screen, where a phone can save or share it.",
  man: [
    {
      heading: 'WHAT IS ENCODED',
      body: "A bare host, with a port or a path if you like (vesen.app, localhost:5173/x), gains https://. A link with a scheme (https:, mailto:, tel:, sms:, geo:, WIFI:, BEGIN:VCARD, otpauth:) is kept as typed; javascript: and vbscript: links are refused. An email address, a phone number, the name of a file here, and anything with spaces are encoded as text, with a tip where a scheme would do more. Put -- before text that starts with '-'.",
    },
    {
      heading: 'NOTES',
      body: 'Error correction is M unless -e sets it, and is raised to Q or H when that fits in the same size; -e M keeps M. The card is drawn in the theme\'s QR colours; saved images are black on white. -t utf8 prints half-block text art, light on an ink field, that you can select and copy; into a pipe or a file, qr always writes text art.',
    },
  ],
};

const MUTED: SpanStyle = { fg: 'muted' };

/** 3120 → `3,120`. */
export function groupThousands(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Why a payload did not fit, with what each level holds and what to try. */
export function tooLongMessage(error: QrCapacityError, kind: Payload['kind']): string {
  const shorter = kind === 'link' ? 'a shorter link' : 'shorter text';
  const holds = (level: EccLevel): string => groupThousands(error.maxBytes[level]);
  const head = `too long for a QR code (${groupThousands(error.bytes)} bytes).`;
  if (error.ecc === 'L') return `${head} Level L holds ${holds('L')} bytes. Try ${shorter}.`;
  return `${head} Level ${error.ecc} holds ${holds(error.ecc)} bytes, L holds ${holds('L')}. Try -e L or ${shorter}.`;
}

/** The text art a pipe or a file receives, and the card falls back to: one string, newline-ended. */
export function textArt(symbol: Pick<QrSymbol, 'size' | 'modules'>, args: Pick<QrArgs, 'type' | 'margin'>): string {
  const style = args.type === 'svg' ? 'utf8' : args.type;
  return `${toText(symbol, { style, margin: args.margin ?? 2 }).join('\n')}\n`;
}

/** The dim lines under a code: the payload's tip, then warnings about the options. */
export function tipsFor(payload: Payload, args: Pick<QrArgs, 'type' | 'margin'>): string[] {
  const tips: string[] = [];
  if (payload.tip !== undefined) tips.push(payload.tip);
  const smallest = args.type === 'svg' ? 4 : 2;
  if (args.margin !== undefined && args.margin < smallest) tips.push('note: quiet zones this small may not scan.');
  if (args.type === 'utf8i') tips.push("note: inverted codes don't scan on every phone.");
  return tips;
}

export function buildView(payload: Payload, symbol: QrSymbol, args: QrArgs): QrView {
  return {
    payload: payload.value,
    kind: payload.kind,
    size: symbol.size,
    modules: symbol.modules,
    version: symbol.version,
    ecc: symbol.ecc,
    requestedEcc: symbol.requestedEcc,
    mask: symbol.mask,
    bytes: new TextEncoder().encode(payload.value).length,
    capacity: symbol.capacityBits / 8,
    options: {
      type: args.type,
      size: args.size,
      margin: args.margin ?? (args.type === 'svg' ? 4 : 2),
      fullscreen: args.fullscreen,
    },
    ...(payload.note === undefined ? {} : { note: payload.note }),
    tips: tipsFor(payload, args),
  };
}

async function help(ctx: CommandContext): Promise<ExitCode> {
  const { commandHelp, withDoc } = await import('../../shell/help');
  for (const block of commandHelp(await withDoc(ctx.spec))) await ctx.stdout.block(block);
  return 0;
}

/** Runs qr. */
export async function run(ctx: CommandContext): Promise<ExitCode> {
  const parsed = parseQrArgs(ctx.args);
  if (parsed.kind === 'help') return help(ctx);
  if (parsed.kind === 'error') return ctx.usage(parsed.message);
  const { args } = parsed;

  let raw = args.operands.join(' ');
  if (args.operands.length === 0 && !ctx.stdin.isTTY) {
    // `echo vesen.app | qr`: what is piped in, less the newline that ends it.
    raw = (await ctx.stdin.text()).replace(/\r?\n$/, '');
  }
  if (raw === '') {
    // Bare `qr` says how to use it; options with nothing to encode are a mistake.
    if (ctx.args.length === 0) return help(ctx);
    return ctx.usage('missing text or link. Try: qr vesen.app');
  }

  const payload = classifyPayload(raw, {
    ...(args.force === undefined ? {} : { force: args.force }),
    fileExists: (name) => {
      try {
        return ctx.fs.exists(ctx.resolve(name));
      } catch {
        return false;
      }
    },
  });
  if ('error' in payload) return payload.usage === true ? ctx.usage(payload.error) : ctx.fail(payload.error);

  let symbol: QrSymbol;
  try {
    symbol = encodeText(payload.value, {
      ecc: args.ec ?? 'M',
      // The level is raised for free unless the visitor chose one.
      boostEcc: args.ec === undefined,
      ...(args.minVersion === undefined ? {} : { minVersion: args.minVersion }),
      ...(args.mask === undefined ? {} : { mask: args.mask }),
      mode: args.eightBit ? 'byte' : 'optimal',
    });
  } catch (error) {
    if (error instanceof QrCapacityError) return ctx.fail(tooLongMessage(error, payload.kind));
    throw error;
  }

  const view = buildView(payload, symbol, args);
  const art = textArt(symbol, args);
  if (!ctx.stdout.isTTY) {
    // Into a pipe or a file: the art alone; the notes go to the terminal, as qrencode's do.
    await ctx.stdout.write(art);
    for (const note of [...(view.note === undefined ? [] : [view.note]), ...view.tips]) await ctx.stderr.line(out.span(note, MUTED));
    return 0;
  }

  await ctx.stdout.block(out.component('qr-card', view, art, `QR code for ${displayPayload(view.payload)}`));
  if (args.fullscreen && ctx.tty.interactive) {
    try {
      await ctx.tty.fullscreen('qr-present', view);
    } catch (error) {
      // ^C closes it; a terminal without full-screen apps leaves the card.
      if (ctx.signal.aborted) throw error;
    }
  }
  return 0;
}
