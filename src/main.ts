import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { installChunkReload } from './platform/chunkReload';
import { canonicalRedirect } from './platform/hosts';

// The entry chunk's URL carries the build hash, so it identifies this deploy.
installChunkReload(window, import.meta.url);

// The apex and the two Firebase hostnames serve the same build; send visitors to the one
// origin so storage and the prompt are the same everywhere.
const canonical = canonicalRedirect(new URL(window.location.href));

if (canonical) {
  window.location.replace(canonical);
} else {
  mount(App, {
    target: document.getElementById('app')!,
  });
}
