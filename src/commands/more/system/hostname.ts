// hostname: show the system's host name, as net-tools' hostname does. The host is vesen on
// every domain; -f gives the site's own name. The body is in hostname.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'hostname',
  category: 'system',
  summary: 'show the system host name',
  synopsis: ['hostname [-f | -d | -i | -s]'],
  flags: [
    { short: 'f', long: 'fqdn', description: "print the fully qualified domain name: this site's" },
    { short: 'd', long: 'domain', description: 'print the DNS domain name' },
    { short: 'i', long: 'ip-address', description: 'print the addresses of the host name' },
    { short: 's', long: 'short', description: 'print the host name cut at the first dot' },
  ],
  args: [{ name: 'NAME', source: { kind: 'free', placeholder: 'new name' }, optional: true }],
  examples: [
    { line: 'hostname', offline: true },
    { line: 'hostname -f', note: 'the site you are on', offline: true },
    { line: 'hostname -i', offline: true },
  ],
  seeAlso: ['uname', 'who'],
  load: () => import('./hostname.run'),
});
