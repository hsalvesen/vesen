import { writable } from 'svelte/store';
import themes from '../../themes.json';
import type { Theme } from '../interfaces/theme';

const defaultColorscheme: Theme = themes.find((t) => t.name.toLowerCase() === 'petroica')!;

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

// Add dynamic favicon update based on theme
function updateFavicon(theme: Theme) {
  if (typeof document === 'undefined') return;

  // Serve icons from public/favicons so they deploy at /favicons/...
  const baseHref = `/favicons/vesenFavicon${theme.name}.ico`;

  // Add a tiny cache-buster to force reload in browsers that cache favicons aggressively
  const href = `${baseHref}?v=${encodeURIComponent(theme.name)}`;

  // Remove existing icon tags to avoid browsers sticking to the first one
  document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]').forEach((link) => link.remove());

  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/x-icon';
  link.href = href;
  document.head.appendChild(link);

  // Optional: also add shortcut icon for older Windows/IE behaviours
  const shortcut = document.createElement('link');
  shortcut.rel = 'shortcut icon';
  shortcut.type = 'image/x-icon';
  shortcut.href = href;
  document.head.appendChild(shortcut);
}

// Get initial theme and set CSS variables immediately
const initialTheme = typeof document !== 'undefined' 
  ? JSON.parse(localStorage.getItem('colorscheme') || JSON.stringify(defaultColorscheme))
  : defaultColorscheme;

// Initialise CSS variables immediately on first load
if (typeof document !== 'undefined') {
  updateCSSVariables(initialTheme);
  updateFavicon(initialTheme);
}

export const theme = writable<Theme>(initialTheme);

theme.subscribe((value) => {
  localStorage.setItem('colorscheme', JSON.stringify(value));
  updateCSSVariables(value);
  updateFavicon(value);
});
