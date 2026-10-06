import { playBeep } from '../beep';
import { errorLine } from '../notice';

/** The developer's LinkedIn profile, which whoami opens. */
export const LINKEDIN_URL = 'https://www.linkedin.com/in/harrysalvesen/';

// banner is a spec in src/commands/portfolio now, drawn from src/commands/lib/banner.ts.
export const systemCommands = {
  // The shell opens LINKEDIN_URL (spec.opens, inside the Enter gesture); this is what it prints.
  whoami: () => `<span class="out-accent">Opening developer's LinkedIn profile...</span>`,
  
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

};
