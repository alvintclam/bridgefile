import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

/**
 * Screenshot / demo mode.
 *
 * When `BRIDGEFILE_SEED=screenshots` is set, the app points its userData
 * directory at a local fixtures folder (supplied via `BRIDGEFILE_USER_DATA`)
 * so that a capture script can boot the app with a known set of connection
 * profiles, bookmarks, and theme preferences — no keychain writes, no real
 * credentials on disk.
 *
 * Activated by the capture-screenshots script. A no-op otherwise.
 */
export function applySeedMode(): void {
  if (process.env.BRIDGEFILE_SEED !== 'screenshots') return;

  const override = process.env.BRIDGEFILE_USER_DATA;
  if (override) {
    try {
      fs.mkdirSync(override, { recursive: true });
      app.setPath('userData', override);
    } catch {
      // If the caller failed to create the dir, fall back to the default
      // and carry on. Seed mode is best-effort — app must still boot.
    }
  }
}
