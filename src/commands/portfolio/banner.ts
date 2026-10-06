// banner: the welcome banner again, as the terminal shows it at boot: compact under 50 columns.

import { defineCommand } from '../../shell/types';
import { bannerBlocks } from '../lib/banner';

export default defineCommand({
  name: 'banner',
  category: 'portfolio',
  summary: 'show the welcome banner',
  description: 'Prints the VESEN logo, the version, the keys and where to start, as the terminal shows them when it opens. Narrow screens get a smaller logo.',
  examples: [{ line: 'banner', offline: true }],
  seeAlso: ['help', 'reset', 'clear'],
  async run(ctx) {
    for (const block of bannerBlocks({ version: __APP_VERSION__, columns: ctx.stdout.columns, touch: ctx.tty.touch })) {
      await ctx.stdout.block(block);
    }
    return 0;
  },
});
