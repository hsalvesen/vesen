// md5sum: compute and check MD5 checksums. The spec is shared with the other checksum commands
// (lib/checksum-spec.ts); the body is in md5sum.run.ts, and MD5 itself in src/lib/md5.ts.

import { checksumSpec } from '../../lib/checksum-spec';

export default checksumSpec('md5sum', 'MD5', 128, () => import('./md5sum.run'));
