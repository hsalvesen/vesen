// The device's location, for `weather --here`, and silently for a bare `weather` once the
// visitor has already granted it (docs/plan/05-weather.md, "Location, chips and extras").
//
// - permission() reads the remembered answer without asking, so a bare `weather` never shows a
//   prompt. Where the Permissions API cannot be asked about geolocation (Safari before 16), the
//   answer is 'prompt'.
// - locate() runs its own timer around getCurrentPosition, because PositionOptions.timeout does
//   not count the time a permission prompt is open, and an in-app browser (Instagram's Android
//   WebView) may never call back at all.
// - Positions are rounded to two decimals (about 1 km) before anything else sees them.
// - Nothing is asked on an http page: browsers refuse geolocation outside a secure context.

import { GeoError, type GeoFailure, type GeoFix, type GeoPermission, type Geolocator } from '../services/weather/types';

/** A position the browser already has, up to this old, is good enough for a forecast. */
export const LOCATE_MAXIMUM_AGE_MS = 10 * 60_000;

/** What the geolocator reads from the page. */
export interface GeoHost {
  readonly isSecureContext?: boolean;
  readonly navigator: {
    readonly geolocation?: Pick<Geolocation, 'getCurrentPosition'> | undefined;
    readonly permissions?: Pick<Permissions, 'query'> | undefined;
  };
}

/** Rounds to two decimals, never giving -0. */
export function roundCoordinate(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

/** GeolocationPositionError's codes: 1 denied, 2 unavailable, 3 timeout. */
function failureFor(code: number): GeoFailure {
  if (code === 1) return 'denied';
  if (code === 3) return 'timeout';
  return 'unavailable';
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new GeoError('unavailable');
}

export function createGeolocator(host: GeoHost | null): Geolocator {
  const geolocation = host?.navigator.geolocation;

  /** Why no position can be had here at all, or null when one may be. */
  const unavailable = (): Extract<GeoPermission, 'unsupported' | 'insecure'> | null => {
    if (!host || !geolocation) return 'unsupported';
    if (host.isSecureContext === false) return 'insecure';
    return null;
  };

  return {
    async permission(): Promise<GeoPermission> {
      const blocked = unavailable();
      if (blocked) return blocked;
      try {
        const status = await host?.navigator.permissions?.query({ name: 'geolocation' });
        if (status?.state === 'granted' || status?.state === 'denied') return status.state;
      } catch {
        // The Permissions API does not know geolocation here; asking would prompt.
      }
      return 'prompt';
    },

    locate({ timeoutMs, signal }): Promise<GeoFix> {
      const blocked = unavailable();
      if (blocked || !geolocation) return Promise.reject(new GeoError(blocked ?? 'unsupported'));
      if (signal?.aborted) return Promise.reject(abortReason(signal));

      return new Promise<GeoFix>((resolve, reject) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const onAbort = (): void => finish(() => reject(signal ? abortReason(signal) : new GeoError('unavailable')));
        function finish(settle: () => void): void {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          settle();
        }
        timer = setTimeout(() => finish(() => reject(new GeoError('timeout'))), Math.max(0, timeoutMs));
        signal?.addEventListener('abort', onAbort, { once: true });
        try {
          geolocation.getCurrentPosition(
            (position) =>
              finish(() => resolve({ lat: roundCoordinate(position.coords.latitude), lon: roundCoordinate(position.coords.longitude) })),
            (error) => finish(() => reject(new GeoError(failureFor(error.code)))),
            { enableHighAccuracy: false, maximumAge: LOCATE_MAXIMUM_AGE_MS, timeout: Math.max(0, timeoutMs) },
          );
        } catch {
          finish(() => reject(new GeoError('unavailable')));
        }
      });
    },
  };
}
