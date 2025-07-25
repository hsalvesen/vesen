import { writable } from 'svelte/store';
import type { Command } from '../interfaces/command';

// Clear both histories on page load to ensure fresh start
localStorage.removeItem('history');
localStorage.removeItem('commandHistory');

// Display history (can be cleared by clear/reset)
export const history = writable<Array<Command>>([]);

// Command navigation history (now also resets on page reload)
export const commandHistory = writable<Array<string>>([]);

history.subscribe((value) => {
  localStorage.setItem('history', JSON.stringify(value));
});

commandHistory.subscribe((value) => {
  localStorage.setItem('commandHistory', JSON.stringify(value));
});
