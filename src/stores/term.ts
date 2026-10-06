// The terminal's size in cells, for what the UI lays out itself: the prompt shortens its path
// below 50 columns. app/bootstrap.ts measures it (platform/measure.ts) and keeps it current.
import { writable } from 'svelte/store';

export const columns = writable<number>(80);
