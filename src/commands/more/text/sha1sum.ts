// sha1sum: compute and check SHA1 checksums. The spec is shared with the other checksum
// commands (lib/checksum-spec.ts); the body is in sha1sum.run.ts.

import { checksumSpec } from '../../lib/checksum-spec';

export default checksumSpec('sha1sum', 'SHA1', 160, () => import('./sha1sum.run'));
