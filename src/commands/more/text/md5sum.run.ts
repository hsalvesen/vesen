// The body of md5sum; its spec, in md5sum.ts, loads this the first time md5sum runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { checksumDoc, runChecksum } from '../../lib/checksum';

export const doc: CommandDoc = checksumDoc('MD5', 128);

export function run(ctx: CommandContext): Promise<ExitCode> {
  return runChecksum(ctx, 'MD5');
}
