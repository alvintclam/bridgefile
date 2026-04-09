import * as https from 'https';
import * as http from 'http';
import { app } from 'electron';

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  downloadUrl: string;
}

const GITHUB_RELEASES_URL =
  'https://api.github.com/repos/alvintclam/bridgefile/releases/latest';

/**
 * Fetch the latest release from GitHub and compare with the current app version.
 */
export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion();

  const releaseData = await fetchJSON(GITHUB_RELEASES_URL);

  const tagName: string = releaseData.tag_name ?? '';
  const latestVersion = tagName.replace(/^v/, '');
  const downloadUrl: string = releaseData.html_url ?? '';

  const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;

  return {
    hasUpdate,
    currentVersion,
    latestVersion,
    downloadUrl,
  };
}

/**
 * Simple semver comparison: returns positive if a > b, negative if a < b, 0 if equal.
 */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  const len = Math.max(pa.length, pb.length);

  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}

/**
 * Minimal HTTPS JSON fetcher (no external dependencies).
 */
function fetchJSON(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': `BridgeFile/${app.getVersion()}`,
        Accept: 'application/vnd.github.v3+json',
      },
    };

    const handler = (res: http.IncomingMessage) => {
      // Follow redirects
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchJSON(res.headers.location).then(resolve, reject);
        return;
      }

      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`GitHub API returned ${res.statusCode}`));
        return;
      }

      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf-8');
          resolve(JSON.parse(body));
        } catch (err) {
          reject(new Error(`Failed to parse GitHub release JSON`));
        }
      });
      res.on('error', reject);
    };

    https.get(url, options, handler).on('error', reject);
  });
}
