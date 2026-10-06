import { playBeep } from '../beep';
import { errorLine } from '../notice';

/**
 * The VESEN logo, six rows of block letters. scripts/og.mjs reads it from this file for the link
 * preview, so it stays a plain template literal.
 */
export const BANNER_ART = `██╗   ██╗███████╗███████╗███████╗███╗   ██╗
██║   ██║██╔════╝██╔════╝██╔════╝████╗  ██║
██║   ██║█████╗  ███████╗█████╗  ██╔██╗ ██║
╚██╗ ██╔╝██╔══╝  ╚════██║██╔══╝  ██║╚██╗██║
 ╚████╔╝ ███████╗███████║███████╗██║ ╚████║
  ╚═══╝  ╚══════╝╚══════╝╚══════╝╚═╝  ╚═══╝`;

export const systemCommands = {
  whoami: () => {
    window.open('https://www.linkedin.com/in/harrysalvesen/');
    return `<span class="out-accent">Opening developer's LinkedIn profile...</span>`;
  },
  
  // fastfetch loads the first time it runs, which keeps it out of the initial chunk.
  fastfetch: async (args: string[], signal?: AbortSignal): Promise<string> => {
    // Undefined when platform/chunkReload has taken the failure over to reload the page.
    const module = await import('./fastfetch').catch(() => undefined);
    if (!module) {
      playBeep();
      return errorLine('fastfetch: could not load the command. Check the connection and try again.');
    }
    return module.fastfetch(args, signal);
  },

  banner: () =>
    // The logo shrinks to fit narrow screens (the art-fit class) rather than wrapping, and screen
    // readers hear the name instead of the block glyphs.
    `<div class="art art-fit" aria-hidden="true">${BANNER_ART}</div><span class="sr-only">Vesen logo</span>` +
    `<span class="out-muted">vesen v${__APP_VERSION__} · a terminal by Has Salvesen</span>\n` +
    `<span class="out-muted">Tab completes · ↑ history · help &lt;cmd&gt; for details</span>\n\n` +
    `<span class="out-strong">Type <span class="out-accent">help</span> to see all available commands.</span>\n` +
    `<span class="out-strong">Type <span class="out-accent">cat README.md</span> to learn more about this terminal.</span>`,
};
