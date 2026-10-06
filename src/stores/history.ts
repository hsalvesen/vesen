import { writable } from 'svelte/store';
import type { Command } from '../interfaces/command';
import { systemCommands } from '../utils/commands/system';

// Initialise history with banner content
const bannerOutput = systemCommands.banner();
const initialHistory: Array<Command> = [{ command: 'banner', outputs: [bannerOutput] }];

// Display history (can be cleared by clear/reset)
export const history = writable<Array<Command>>(initialHistory);

// Command navigation history for the arrow keys; it starts empty on every page load.
export const commandHistory = writable<Array<string>>([]);

// Progress text for long-running commands; used by Input to show phase-specific loading messages
export const speedtestPhase = writable<string>('');
