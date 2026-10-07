import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { get } from 'svelte/store';
import { bootstrap, renderBootError } from './app/bootstrap';
import { bannerBlocks } from './commands/lib/banner';
import { columns } from './stores/term';

const target = document.getElementById('app');

try {
  // The entry chunk's URL carries the build hash, so it identifies this deploy.
  const booted = bootstrap({
    window,
    build: import.meta.url,
    // At boot, and again for reset and a new login, at the width the terminal has then.
    banner: () =>
      bannerBlocks({ version: __APP_VERSION__, columns: get(columns), touch: window.matchMedia?.('(pointer: coarse)').matches ?? false }),
    legacy: () => import('./utils/legacyShell').then((module) => module.legacyBindings()),
  });
  if (booted) {
    if (!target) throw new Error('#app is missing from the page');
    mount(App, {
      target,
      props: {
        shell: booted.shell,
        platform: { opener: booted.opener, clipboard: booted.clipboard, session: booted.storage.session, restored: booted.restored },
      },
    });
  }
} catch (error) {
  console.error(error);
  renderBootError(document, target, error);
}
