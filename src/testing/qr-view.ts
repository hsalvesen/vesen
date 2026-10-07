// The view a `qr` line would build, for the card's and Present mode's tests: the command's own
// option parser, payload rules and encoder, without a shell.

import { buildView } from '../commands/portfolio/qr.run';
import { parseQrArgs } from '../commands/lib/qr-args';
import { classifyPayload } from '../commands/lib/qr-payload';
import { encodeText, type QrView } from '../lib/qr';

/** The view for `qr <words>`. */
export function qrView(...words: string[]): QrView {
  const parsed = parseQrArgs(words);
  if (parsed.kind !== 'args') throw new Error(`not a qr line: qr ${words.join(' ')}`);
  const { args } = parsed;
  const payload = classifyPayload(args.operands.join(' '), args.force === undefined ? {} : { force: args.force });
  if ('error' in payload) throw new Error(payload.error);
  const symbol = encodeText(payload.value, {
    ecc: args.ec ?? 'M',
    boostEcc: args.ec === undefined,
    ...(args.minVersion === undefined ? {} : { minVersion: args.minVersion }),
    ...(args.mask === undefined ? {} : { mask: args.mask }),
    mode: args.eightBit ? 'byte' : 'optimal',
  });
  return buildView(payload, symbol, args);
}
