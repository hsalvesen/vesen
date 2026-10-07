// sha256sum: compute and check SHA256 checksums. The spec is shared with the other checksum
// commands (lib/checksum-spec.ts); the body is in sha256sum.run.ts.

import { checksumSpec } from '../../lib/checksum-spec';

export default checksumSpec('sha256sum', 'SHA256', 256, () => import('./sha256sum.run'));
