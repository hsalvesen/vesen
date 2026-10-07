// What the network commands of wave D share besides DNS: the time as their output stamps it,
// and a failed request in a few honest words.

import type { NetError } from '../../services/types';
import type { CommandContext } from '../../shell/types';
import { formatDate } from '../system/date.run';

/** True when the platform knows the zone. */
function knownZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The zone times are shown in, as date picks it: $TZ when it names a zone, else the device's. */
export function zoneOf(ctx: Pick<CommandContext, 'env' | 'clock'>): string {
  const tz = ctx.env.get('TZ');
  if (tz !== undefined && tz !== '') return knownZone(tz) ? tz : 'UTC';
  return ctx.clock.timeZone();
}

/** `ms` (now by default) in date's +FORMAT, in the zone date would use. */
export function stamp(ctx: Pick<CommandContext, 'env' | 'clock'>, format: string, ms: number = ctx.clock.now()): string {
  return formatDate(format, ms, zoneOf(ctx));
}

/** Why a request to `host` failed, in a few words: `no answer within 8 s`, `HTTP 503`. */
export function netReason(error: NetError): string {
  switch (error.kind) {
    case 'timeout':
      return `no answer within ${Math.round((error.timeoutMs ?? 8000) / 1000)} s`;
    case 'offline':
      return 'the browser is offline';
    case 'cors':
      return 'blocked by CORS or unreachable (the browser does not say which)';
    case 'network':
      return 'unreachable';
    case 'http':
      return `HTTP ${error.status ?? 'error'}`;
    case 'parse':
      return 'an answer that could not be read';
    case 'abort':
      return 'cancelled';
  }
}
