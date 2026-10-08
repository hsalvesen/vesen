// Back before an app's chunk has come (a phone on a slow network in Instagram's browser): the app
// closes as soon as it shows, the way it closes itself, so `man` still ends quietly and an
// unchanged `nano` with EDITOR_CLOSED; only a chunk that cannot load closes with no result. Back
// has already taken the entry, so nothing is pushed again or gone back over.
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EDITOR_CLOSED, type EditorView } from '../lib/nano';
import { PAGER_CLOSED, type PagerView } from '../lib/pager';
import type { FullscreenView } from '../shell/types';
import AppHost from './AppHost.svelte';

/** Holds every app's chunk back until the test lets it through. */
const chunks = vi.hoisted(() => {
  let release: () => void = () => {};
  let arrived = new Promise<void>((resolve) => (release = resolve));
  return {
    arrive: () => release(),
    reset: () => (arrived = new Promise<void>((resolve) => (release = resolve))),
    wait: () => arrived,
  };
});

vi.mock('./apps/registry', async (importOriginal) => {
  const real = await importOriginal<typeof import('./apps/registry')>();
  return {
    ...real,
    appLoader: (view: string) => {
      if (view === 'broken') return () => chunks.wait().then(() => Promise.reject(new Error('the chunk did not load')));
      const load = real.appLoader(view);
      return load === undefined ? undefined : () => chunks.wait().then(load);
    },
  };
});

const vesenEntry = (): boolean => typeof (history.state as { vesenApp?: unknown } | null)?.vesenApp === 'string';

const pagerView = (): PagerView => ({ title: 'ls(1)', lines: [[{ text: 'LS(1)' }]], mode: 'less', touch: true, columns: 40, rows: 20 });
const editorView = (): EditorView => ({ name: 'x.txt', text: '', message: '[ New File ]', touch: true, save: (name) => ({ ok: true, name, message: '[ Wrote 0 lines ]' }) });

async function showSlowly(view: FullscreenView | 'broken', props: unknown) {
  chunks.reset();
  const onclose = vi.fn();
  const pushes = vi.spyOn(history, 'pushState');
  const backs = vi.spyOn(history, 'back');
  render(AppHost, { props: { request: { id: 21, view: view as FullscreenView, props }, onclose } });
  await tick();
  expect(vesenEntry()).toBe(true);
  return { onclose, pushes, backs };
}

/** The chunk comes, and the app shows. */
async function arrive(): Promise<void> {
  chunks.arrive();
  await vi.dynamicImportSettled();
  for (let i = 0; i < 5; i += 1) await tick();
}

afterEach(() => {
  vi.restoreAllMocks();
  history.replaceState(null, '');
});

describe('Back while an app is still loading', () => {
  it("closes an unchanged nano as ^X does once the editor comes, not as 'could not be opened'", async () => {
    const { onclose, pushes, backs } = await showSlowly('editor', editorView());
    history.back();
    await tick();
    expect(onclose).not.toHaveBeenCalled();
    expect(vesenEntry()).toBe(false);

    await arrive();
    expect(onclose).toHaveBeenCalledTimes(1);
    expect(onclose).toHaveBeenCalledWith(21, EDITOR_CLOSED);
    // Only the visitor's Back, and only the push made when it opened.
    expect(backs).toHaveBeenCalledTimes(1);
    expect(pushes).toHaveBeenCalledTimes(1);
    expect(vesenEntry()).toBe(false);
  });

  it('closes the pager as q does once it comes, so man prints nothing in its place', async () => {
    const { onclose, pushes, backs } = await showSlowly('pager', pagerView());
    history.back();
    await tick();
    expect(onclose).not.toHaveBeenCalled();
    await arrive();
    expect(onclose).toHaveBeenCalledTimes(1);
    expect(onclose).toHaveBeenCalledWith(21, PAGER_CLOSED);
    expect(backs).toHaveBeenCalledTimes(1);
    expect(pushes).toHaveBeenCalledTimes(1);
  });

  it('lets nano take its offer to restore away first, and catches the next Back too', async () => {
    const { onclose, pushes } = await showSlowly('editor', { ...editorView(), kept: 'from before\n', keep: vi.fn() });
    history.back();
    await tick();
    await arrive();
    expect(onclose).not.toHaveBeenCalled();
    expect(document.querySelector('.question')).toBeNull();
    expect(vesenEntry()).toBe(true);
    expect(pushes).toHaveBeenCalledTimes(2);
    history.back();
    expect(onclose).toHaveBeenCalledWith(21, EDITOR_CLOSED);
  });

  it('closes with no result only when the chunk cannot load', async () => {
    const { onclose } = await showSlowly('broken', {});
    history.back();
    await tick();
    expect(onclose).not.toHaveBeenCalled();
    await arrive();
    await vi.waitFor(() => expect(onclose).toHaveBeenCalledTimes(1));
    expect(onclose).toHaveBeenCalledWith(21, undefined);
  });

  it('shows the app as usual when Back does not come', async () => {
    const { onclose } = await showSlowly('pager', pagerView());
    await arrive();
    expect(onclose).not.toHaveBeenCalled();
    expect(vesenEntry()).toBe(true);
    history.back();
    expect(onclose).toHaveBeenCalledWith(21, PAGER_CLOSED);
  });
});
