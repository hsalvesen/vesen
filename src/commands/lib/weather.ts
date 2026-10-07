// The weather command's way to the page's weather service. The service reaches the network, the
// browser's storage and the device's location, so the command (DOM-free) never builds it: the
// app provides a loader (app/shell.ts, from bootstrap), and the service's chunk is fetched the
// first time weather runs. Without a loader, as in most tests, weather has no service.

import type { WeatherService } from '../../services/weather/types';

/** Builds the page's weather service, in its own chunk. */
export type WeatherLoader = () => Promise<WeatherService>;

let loader: WeatherLoader | null = null;
let service: Promise<WeatherService> | null = null;

/** Sets where the weather service comes from, replacing any before it; null leaves none. */
export function provideWeather(load: WeatherLoader | null): void {
  loader = load;
  service = null;
}

/**
 * The page's weather service, built once; null when none is provided. A load that fails (a chunk
 * from an older deploy, say) is tried again the next time.
 */
export function weatherService(): Promise<WeatherService> | null {
  if (loader === null) return null;
  if (service === null) {
    const loading = loader();
    loading.catch(() => {
      if (service === loading) service = null;
    });
    service = loading;
  }
  return service;
}

/** `reset`: forgets the saved places and lookups. Nothing happens without a service. */
export function forgetWeather(): void {
  void weatherService()?.then(
    (weather) => weather.forget(),
    () => {},
  );
}
