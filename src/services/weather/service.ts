// The page's weather service: the sources (their caches and the Nominatim throttle), place
// resolution, the recent places and the device's location, behind the port the weather command
// uses (WeatherService in ./types.ts). The composition root builds one per page, the first time
// weather runs, so none of this is in the first paint or the kernel.

import { isNetError } from '../net';
import type { KV } from '../types';
import { resolvePlace } from './resolve';
import { NOMINATIM_ENABLED, createWeatherSources, type WeatherSources } from './sources';
import { GeoError, type Geolocator, type Place, type WeatherService } from './types';

export interface WeatherServiceOptions {
  /** Where places and lookups are kept; without it they last for the page. */
  readonly kv?: KV<'local'> | null;
  /** The device's location; without it, --here falls back to the network's. */
  readonly geolocation?: Geolocator;
  readonly now?: () => number;
  /** Whether OpenStreetMap is asked after Open-Meteo finds nothing, and to name points. */
  readonly nominatim?: boolean;
  /** Sources to use instead of the page's own: for tests. */
  readonly sources?: WeatherSources;
}

/** A browser with no way to give a location. */
export const NO_GEOLOCATION: Geolocator = {
  permission: () => Promise.resolve('unsupported'),
  locate: () => Promise.reject(new GeoError('unsupported')),
};

const aborted = (error: unknown, signal: AbortSignal | undefined): boolean =>
  Boolean(signal?.aborted) || (isNetError(error) && error.kind === 'abort');

export function createWeatherService(options: WeatherServiceOptions = {}): WeatherService {
  const sources =
    options.sources ?? createWeatherSources({ kv: options.kv ?? null, ...(options.now === undefined ? {} : { now: options.now }) });
  const nominatim = options.nominatim ?? NOMINATIM_ENABLED;

  return {
    resolve: (query, resolveOptions = {}) =>
      resolvePlace(query, {
        sources,
        nominatim,
        signal: resolveOptions.signal ?? null,
        ...(resolveOptions.onPhase === undefined ? {} : { onPhase: resolveOptions.onPhase }),
        recent: sources.recents.list().map((place) => place.name),
      }),
    forecast: (lat, lon, signal) => sources.forecast(lat, lon, signal ?? null),
    async reverse(lat, lon, signal): Promise<Place | null> {
      if (!nominatim) return null;
      try {
        return await sources.nominatimReverse(lat, lon, signal ?? null);
      } catch (error) {
        // A name is a nicety: without one the card shows the coordinates.
        if (aborted(error, signal)) throw error;
        return null;
      }
    },
    ipLocate: (signal) => sources.ipLocate(signal ?? null),
    geolocation: options.geolocation ?? NO_GEOLOCATION,
    recent: () => sources.recents.list(),
    remember: (place) => sources.recents.add(place),
    forget: () => sources.forget(),
  };
}
