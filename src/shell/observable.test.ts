import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { readonly, writable } from './observable';

describe('observable stores', () => {
  it('follow the Svelte store contract, so components can use $store', () => {
    const store = writable(1);
    expect(get(store)).toBe(1);
    const seen: number[] = [];
    const stop = store.subscribe((value) => seen.push(value));
    store.set(2);
    store.update((value) => value + 1);
    stop();
    store.set(9);
    expect(seen).toEqual([1, 2, 3]);
    expect(store.get()).toBe(9);
  });

  it('skip a primitive that did not change, and always notify for objects', () => {
    const count = writable(0);
    const object = writable({ a: 1 });
    const seen: unknown[] = [];
    count.subscribe((value) => seen.push(value));
    object.subscribe((value) => seen.push(value));
    count.set(0);
    object.set(object.get());
    expect(seen).toHaveLength(3);
  });

  it('lets the same function subscribe twice and unsubscribe once', () => {
    const store = writable('a');
    const seen: string[] = [];
    const run = (value: string): void => {
      seen.push(value);
    };
    const first = store.subscribe(run);
    store.subscribe(run);
    first();
    store.set('b');
    expect(seen).toEqual(['a', 'a', 'b']);
  });

  it('have a read-only view', () => {
    const store = writable(1);
    const view = readonly(store);
    expect('set' in view).toBe(false);
    store.set(2);
    expect(view.get()).toBe(2);
  });
});
