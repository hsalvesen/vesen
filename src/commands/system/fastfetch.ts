// fastfetch: this device as the browser sees it, beside its system's logo, every row labelled
// for what it is (F050, F041). Nothing is sent anywhere unless --net asks for the public IP.

import { defineCommand } from '../../shell/types';

export default defineCommand({
  name: 'fastfetch',
  aliases: ['neofetch'],
  category: 'system',
  summary: 'show information about this system',
  synopsis: ['fastfetch [--net]'],
  featured: true,
  budgetMs: 10_000,
  flags: [{ long: 'net', description: 'add your public IP, asked of api.ipify.org' }],
  loadingLabel: () => 'gathering system information…',
  examples: [
    { line: 'fastfetch', note: 'this system, at a glance', offline: true, starter: 3 },
    { line: 'fastfetch --net', note: 'with your public IP' },
    { line: 'neofetch', note: 'the same, by its older name', offline: true },
  ],
  seeAlso: ['theme', 'privacy', 'speedtest'],
  load: () => import('./fastfetch.run'),
});
