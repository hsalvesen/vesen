import { DROPPED_LEGACY_KEYS } from '../services/storage-keys';

/**
 * Removes the pre-overhaul keys that have no successor (`history`, `commandHistory`). They held
 * a visitor's last session, output and typed lines included, and nothing reads them any more.
 * Interim: services/storage.ts takes over the one-time migration with the storage service.
 */
export function dropLegacyKeys(target: Pick<Window, 'localStorage'>): void {
  try {
    // Reading the property itself throws when site data is blocked; then there is nothing to remove.
    const storage = target.localStorage;
    for (const key of DROPPED_LEGACY_KEYS) storage.removeItem(key);
  } catch {
    // Storage is unavailable, so the keys cannot linger either.
  }
}
