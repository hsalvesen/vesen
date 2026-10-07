import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeoError } from '../services/weather/types';
import { LOCATE_MAXIMUM_AGE_MS, createGeolocator, roundCoordinate, type GeoHost } from './geolocation';

type Success = (position: GeolocationPosition) => void;
type Failure = (error: GeolocationPositionError) => void;

interface FakeDevice {
  readonly host: GeoHost;
  readonly calls: { success: Success; failure: Failure; options: PositionOptions | undefined }[];
  state: PermissionState | 'throws';
}

function device(options: { secure?: boolean; geolocation?: boolean; permissions?: boolean } = {}): FakeDevice {
  const fake: FakeDevice = {
    calls: [],
    state: 'prompt',
    host: {
      isSecureContext: options.secure ?? true,
      navigator: {
        ...(options.geolocation === false
          ? {}
          : {
              geolocation: {
                getCurrentPosition: (success: Success, failure?: Failure | null, positionOptions?: PositionOptions) => {
                  fake.calls.push({ success, failure: failure ?? (() => {}), options: positionOptions });
                },
              },
            }),
        ...(options.permissions === false
          ? {}
          : {
              permissions: {
                query: () => (fake.state === 'throws' ? Promise.reject(new TypeError('not supported')) : Promise.resolve({ state: fake.state } as PermissionStatus)),
              },
            }),
      },
    },
  };
  return fake;
}

const position = (latitude: number, longitude: number): GeolocationPosition =>
  ({ coords: { latitude, longitude, accuracy: 20 }, timestamp: 0 }) as unknown as GeolocationPosition;
const positionError = (code: number): GeolocationPositionError => ({ code, message: 'no' }) as GeolocationPositionError;

const rejectionOf = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (error: unknown) => error,
  );

afterEach(() => {
  vi.useRealTimers();
});

describe('permission', () => {
  it('reads the remembered answer without asking', async () => {
    const fake = device();
    const geo = createGeolocator(fake.host);
    for (const state of ['granted', 'denied', 'prompt'] as const) {
      fake.state = state;
      expect(await geo.permission()).toBe(state);
    }
    expect(fake.calls).toEqual([]);
  });

  it("counts a browser that cannot be asked about geolocation as one that would prompt", async () => {
    const fake = device();
    fake.state = 'throws';
    expect(await createGeolocator(fake.host).permission()).toBe('prompt');
    expect(await createGeolocator(device({ permissions: false }).host).permission()).toBe('prompt');
  });

  it('knows when no location can be had at all', async () => {
    expect(await createGeolocator(null).permission()).toBe('unsupported');
    expect(await createGeolocator(device({ geolocation: false }).host).permission()).toBe('unsupported');
    expect(await createGeolocator(device({ secure: false }).host).permission()).toBe('insecure');
  });
});

describe('locate', () => {
  it('rounds the position to two decimals, and asks for a coarse, recent one', async () => {
    const fake = device();
    const located = createGeolocator(fake.host).locate({ timeoutMs: 8000 });
    expect(fake.calls[0]?.options).toEqual({ enableHighAccuracy: false, maximumAge: LOCATE_MAXIMUM_AGE_MS, timeout: 8000 });
    fake.calls[0]?.success(position(-33.86882, 151.20929));
    expect(await located).toEqual({ lat: -33.87, lon: 151.21 });
    expect(roundCoordinate(-0.004)).toBe(0);
    expect(Object.is(roundCoordinate(-0.004), -0)).toBe(false);
  });

  it('says why there is no position', async () => {
    for (const [code, reason] of [[1, 'denied'], [2, 'unavailable'], [3, 'timeout']] as const) {
      const fake = device();
      const located = createGeolocator(fake.host).locate({ timeoutMs: 8000 });
      fake.calls[0]?.failure(positionError(code));
      expect(await rejectionOf(located)).toEqual(new GeoError(reason));
    }
  });

  it('gives up on its own timer when the browser never answers', async () => {
    vi.useFakeTimers();
    const fake = device();
    const located = rejectionOf(createGeolocator(fake.host).locate({ timeoutMs: 15_000 }));
    await vi.advanceTimersByTimeAsync(14_999);
    await vi.advanceTimersByTimeAsync(1);
    expect(await located).toMatchObject({ reason: 'timeout' });
    // A late answer changes nothing.
    fake.calls[0]?.success(position(1, 2));
  });

  it('stops when the command is interrupted', async () => {
    const fake = device();
    const controller = new AbortController();
    const located = rejectionOf(createGeolocator(fake.host).locate({ timeoutMs: 8000, signal: controller.signal }));
    const reason = new Error('^C');
    controller.abort(reason);
    expect(await located).toBe(reason);

    const before = new AbortController();
    before.abort(reason);
    expect(await rejectionOf(createGeolocator(fake.host).locate({ timeoutMs: 8000, signal: before.signal }))).toBe(reason);
    expect(fake.calls).toHaveLength(1);
  });

  it('never asks on an insecure page or without the API', async () => {
    const insecure = device({ secure: false });
    expect(await rejectionOf(createGeolocator(insecure.host).locate({ timeoutMs: 8000 }))).toEqual(new GeoError('insecure'));
    expect(insecure.calls).toEqual([]);
    expect(await rejectionOf(createGeolocator(null).locate({ timeoutMs: 8000 }))).toEqual(new GeoError('unsupported'));
  });

  it('treats a throwing API as unavailable', async () => {
    const host: GeoHost = {
      navigator: {
        geolocation: {
          getCurrentPosition: () => {
            throw new Error('blocked by policy');
          },
        },
      },
    };
    expect(await rejectionOf(createGeolocator(host).locate({ timeoutMs: 8000 }))).toEqual(new GeoError('unavailable'));
  });
});
