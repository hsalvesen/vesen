import { writable } from 'svelte/store';
import themes from '../../themes.json';
import type { Theme } from '../interfaces/theme';

const defaultColorscheme: Theme = themes.find((t) => t.name.toLowerCase() === 'swamphen')!;

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

// Dynamically highlight current theme in any past "theme ls" outputs
function updateThemeListHighlight(theme: Theme) {
  if (typeof document === 'undefined') return;
  const current = theme.name.toLowerCase();
  const nodes = document.querySelectorAll<HTMLElement>('.theme-name');

  nodes.forEach((el) => {
    const name = el.getAttribute('data-theme-name')?.toLowerCase();
    if (name && name === current) {
      el.classList.add('is-current');
    } else {
      el.classList.remove('is-current');
    }
  });
}

// Update fastfetch "WM Theme" value in past outputs
function updateFastfetchThemeName(theme: Theme) {
  if (typeof document === 'undefined') return;
  const nodes = document.querySelectorAll<HTMLElement>('.current-theme-name');
  nodes.forEach((el) => {
    el.textContent = theme.name;
  });
}

// Add dynamic favicon update based on theme
function updateFavicon(theme: Theme) {
  if (typeof document === 'undefined') return;

  // Map theme "wallaby" -> "Wallaby" to match file naming
  const fileNameTheme = theme.name.charAt(0).toUpperCase() + theme.name.slice(1);
  const file = `/favicons/vesenFavicon${fileNameTheme}.ico`;
  const href = `${file}?v=${encodeURIComponent(fileNameTheme)}`;

  const links = document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="shortcut icon"]');
  if (links.length > 0) {
    links.forEach((link) => {
      link.rel = 'icon';
      link.type = 'image/x-icon';
      link.sizes = 'any';
      link.href = href;
    });
  } else {
    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/x-icon';
    link.sizes = 'any';
    link.href = href;
    document.head.appendChild(link);
  }
}

// Get initial theme and set CSS variables immediately
const initialTheme = typeof document !== 'undefined' 
  ? JSON.parse(localStorage.getItem('colorscheme') || JSON.stringify(defaultColorscheme))
  : defaultColorscheme;

// Initialise CSS variables immediately on first load
if (typeof document !== 'undefined') {
  updateCSSVariables(initialTheme);
  updateFavicon(initialTheme);
  updateThemeListHighlight(initialTheme);
  updateFastfetchThemeName(initialTheme);
}

export const theme = writable<Theme>(initialTheme);

theme.subscribe((value) => {
  localStorage.setItem('colorscheme', JSON.stringify(value));
  updateCSSVariables(value);
  updateFavicon(value);
  updateThemeListHighlight(value);
  updateFastfetchThemeName(value);
});
