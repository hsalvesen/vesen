import { playBeep } from '../beep';
import { errorLine } from '../notice';

// banner is a spec in src/commands/portfolio now, drawn from src/commands/lib/banner.ts.
export const systemCommands = {
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
