// The part of the page the visitor can see, as platform/viewport.ts measures it: the phone dock
// lays itself out by its height (full, compact or minimal). Pure state; app/bootstrap.ts keeps it
// current. A height of 0 means not measured yet.
import { writable } from 'svelte/store';
import type { VisibleArea } from '../platform/viewport';

export const visibleArea = writable<VisibleArea>({ height: 0, keyboardOpen: false });
