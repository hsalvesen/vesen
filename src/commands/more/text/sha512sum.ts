// sha512sum: compute and check SHA512 checksums. The spec is shared with the other checksum
// commands (lib/checksum-spec.ts); the body is in sha512sum.run.ts.

import { checksumSpec } from '../../lib/checksum-spec';

export default checksumSpec('sha512sum', 'SHA512', 512, () => import('./sha512sum.run'));
