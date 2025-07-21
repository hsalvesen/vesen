import { writable } from 'svelte/store';
import type { Command } from '../interfaces/command';

// Clear history on page load to ensure fresh start
localStorage.removeItem('history');

// Display history (can be cleared by clear/reset)
export const history = writable<Array<Command>>([]);

// Command navigation history (persists through clear/reset)
export const commandHistory = writable<Array<string>>(
  JSON.parse(localStorage.getItem('commandHistory') || '[]'),
);

history.subscribe((value) => {
  localStorage.setItem('history', JSON.stringify(value));
});

commandHistory.subscribe((value) => {
  localStorage.setItem('commandHistory', JSON.stringify(value));
});
