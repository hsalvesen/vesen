// Time-zone arithmetic with Intl only (no library), for providers that send local wall times.

function zoneOffsetMs(timeZone: string, epochMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(epochMs));
  const field = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value);
  const wallAsUtc = Date.UTC(field('year'), field('month') - 1, field('day'), field('hour'), field('minute'), field('second'));
  return wallAsUtc - Math.floor(epochMs / 1000) * 1000;
}

/** Unix seconds for a wall time such as `2026-10-05T15:59:59` in `timeZone`, or null. */
export function zonedTimeToEpoch(wallTime: string, timeZone: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})$/.exec(wallTime.trim());
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [number, number, number, number, number, number];
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  try {
    // A second pass settles times near a daylight-saving change.
    const first = wall - zoneOffsetMs(timeZone, wall);
    const epochMs = wall - zoneOffsetMs(timeZone, first);
    return Number.isFinite(epochMs) ? Math.round(epochMs / 1000) : null;
  } catch {
    return null;
  }
}

/** The zone's short name at an instant in US English (`EDT`), or null where Intl has none. */
export function zoneAbbreviation(timeZone: string, epochSec: number): string | null {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
      .formatToParts(new Date(epochSec * 1000))
      .find((part) => part.type === 'timeZoneName')?.value;
    return name && !name.startsWith('GMT') ? name : null;
  } catch {
    return null;
  }
}
