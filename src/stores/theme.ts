import { writable } from 'svelte/store';
import themes from '../../themes.json';
import type { Theme } from '../interfaces/theme';

const defaultColorscheme: Theme = themes.find((t) => t.name.toLowerCase() === 'pinkrobin')!;

// Function to update CSS variables
function updateCSSVariables(theme: Theme) {
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.style.setProperty('--theme-black', theme.black);
    root.style.setProperty('--theme-red', theme.red);
    root.style.setProperty('--theme-green', theme.green);
    root.style.setProperty('--theme-yellow', theme.yellow);
    root.style.setProperty('--theme-blue', theme.blue);
    root.style.setProperty('--theme-purple', theme.purple);
    root.style.setProperty('--theme-cyan', theme.cyan);
    root.style.setProperty('--theme-white', theme.white);
    root.style.setProperty('--theme-bright-black', theme.brightBlack);
    root.style.setProperty('--theme-bright-red', theme.brightRed);
    root.style.setProperty('--theme-bright-green', theme.brightGreen);
    root.style.setProperty('--theme-bright-yellow', theme.brightYellow);
    root.style.setProperty('--theme-bright-blue', theme.brightBlue);
    root.style.setProperty('--theme-bright-purple', theme.brightPurple);
    root.style.setProperty('--theme-bright-cyan', theme.brightCyan);
    root.style.setProperty('--theme-bright-white', theme.brightWhite);
    root.style.setProperty('--theme-foreground', theme.foreground);
    root.style.setProperty('--theme-background', theme.background);
  }
}

export const theme = writable<Theme>(
  JSON.parse(
    localStorage.getItem('colorscheme') || JSON.stringify(defaultColorscheme),
  ),
);

// Initialize CSS variables on first load
if (typeof document !== 'undefined') {
  const currentTheme = JSON.parse(
    localStorage.getItem('colorscheme') || JSON.stringify(defaultColorscheme),
  );
  updateCSSVariables(currentTheme);
}

theme.subscribe((value) => {
  localStorage.setItem('colorscheme', JSON.stringify(value));
  updateCSSVariables(value);
});
