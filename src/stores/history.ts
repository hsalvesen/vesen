import { writable } from 'svelte/store';
import type { Command } from '../interfaces/command';

// Display history (can be cleared by clear/reset)
export const history = writable<Array<Command>>(
  JSON.parse(localStorage.getItem('history') || '[]'),
);

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
