import { writable } from 'svelte/store';
import type { Command } from '../interfaces/command';

// The transcript (cleared by clear and reset). It starts empty; app/bootstrap.ts adds the banner.
export const history = writable<Array<Command>>([]);

// Command navigation history for the arrow keys; it starts empty on every page load.
export const commandHistory = writable<Array<string>>([]);

// Progress text for long-running commands; used by Input to show phase-specific loading messages
export const speedtestPhase = writable<string>('');
