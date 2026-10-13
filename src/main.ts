import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { bootstrap, renderBootError } from './app/bootstrap';
import { bannerBlocks } from './commands/lib/banner';

const target = document.getElementById('app');

try {
  // The entry chunk's URL carries the build hash, so it identifies this deploy.
  const booted = bootstrap({
    window,
    build: import.meta.url,
    // At boot, and again for reset and a new login: the same logo on every screen, scaled to fit.
    banner: () => bannerBlocks({ version: __APP_VERSION__ }),
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
