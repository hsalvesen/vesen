// banner: the welcome banner again, as the terminal shows it at boot, the logo scaled to fit.

import { defineCommand } from '../../shell/types';
import { bannerBlocks } from '../lib/banner';

export default defineCommand({
  name: 'banner',
  category: 'portfolio',
  summary: 'show the welcome banner',
  description: 'Prints the VESEN logo and the version, what vesen is and where to start, as the terminal shows them when it opens. A narrow screen shows the same logo, smaller.',
  examples: [{ line: 'banner', offline: true }],
  seeAlso: ['help', 'reset', 'clear'],
  async run(ctx) {
    for (const block of bannerBlocks({ version: __APP_VERSION__ })) {
      await ctx.stdout.block(block);
    }
    return 0;
  },
});
