import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { bootstrap, renderBootError } from './app/bootstrap';
import { systemCommands } from './utils/commands/system';

const target = document.getElementById('app');

try {
  // The entry chunk's URL carries the build hash, so it identifies this deploy.
  const booted = bootstrap({ window, build: import.meta.url, banner: () => systemCommands.banner() });
  if (booted) {
    if (!target) throw new Error('#app is missing from the page');
    mount(App, { target });
  }
} catch (error) {
  console.error(error);
  renderBootError(document, target, error);
}
