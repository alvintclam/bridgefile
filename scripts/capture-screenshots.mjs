// @ts-check
/**
 * BridgeFile screenshot capture — Playwright driving Electron.
 *
 * Usage:
 *   npm run build              # ensure ./dist is fresh
 *   npm run screenshot         # runs this script
 *
 * Output:
 *   ../bridgefile-web/public/screenshots/*.png
 *
 * Strategy:
 *   1. Create a temp userData dir, copy fixture JSON files into it.
 *   2. Launch Electron with BRIDGEFILE_SEED=screenshots pointing at that dir.
 *   3. Drive the UI with Playwright and screenshot each state.
 *   4. Clean up the temp dir.
 *
 * Notes:
 *   - No real SFTP/FTP/S3 connections are attempted — the app boots with the
 *     site manager populated from fixtures and never tries to connect.
 *   - On Linux, run via `xvfb-run -a npm run screenshot` if there's no display.
 */

import { _electron as electron } from "playwright";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.resolve(
  ROOT,
  "..",
  "bridgefile-web",
  "public",
  "screenshots"
);
const FIXTURES_DIR = path.join(__dirname, "fixtures");

async function run() {
  const userDataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "bridgefile-shots-")
  );
  console.log("[shots] userData:", userDataDir);

  // Copy fixture files into the temp userData dir — these are the files the
  // app's store layer reads on boot.
  for (const file of ["connections.json", "bookmarks.json"]) {
    const src = path.join(FIXTURES_DIR, file);
    const dst = path.join(userDataDir, file);
    if (fs.existsSync(src)) fs.copyFileSync(src, dst);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const app = await electron.launch({
    args: [path.join(ROOT, "dist", "main", "main.js")],
    cwd: ROOT,
    env: {
      ...process.env,
      BRIDGEFILE_SEED: "screenshots",
      BRIDGEFILE_USER_DATA: userDataDir,
      NODE_ENV: "production",
    },
  });

  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 900 });
  // Give the renderer time to hydrate and read the seeded profiles.
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);

  const shots = [
    {
      file: "main-light.png",
      setup: async () => {
        await setTheme(page, "light");
      },
    },
    {
      file: "main-dark.png",
      setup: async () => {
        await setTheme(page, "dark");
      },
    },
    {
      file: "site-manager.png",
      setup: async () => {
        await setTheme(page, "dark");
        // Expand the Site Manager group if the UI collapses it by default.
        const trigger = page
          .getByRole("button", { name: /connections|site manager|連線/i })
          .first();
        if (await trigger.count()) await trigger.click();
      },
    },
    {
      file: "s3-connection.png",
      setup: async () => {
        const newConn = page
          .getByRole("button", { name: /new connection|new|\+ new|新增|\+ 新/i })
          .first();
        if (await newConn.count()) {
          await newConn.click();
          // Try to switch to the S3 tab.
          const s3Tab = page.getByRole("tab", { name: /s3/i }).first();
          if (await s3Tab.count()) await s3Tab.click();
        }
      },
    },
  ];

  for (const shot of shots) {
    try {
      await shot.setup();
      await page.waitForTimeout(500);
      const target = path.join(OUT_DIR, shot.file);
      await page.screenshot({ path: target });
      console.log("[shots]", shot.file, "→", target);
    } catch (err) {
      console.warn("[shots] failed:", shot.file, err);
    }
  }

  await app.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
  console.log("[shots] done.");
}

async function setTheme(page, mode) {
  // Try a keyboard shortcut first (documented: Ctrl/Cmd + Shift + T).
  // If it toggles instead of absolute-setting, repeat once to get back.
  const current = await page
    .evaluate(() => document.documentElement.dataset.theme || "")
    .catch(() => "");
  if (current === mode) return;
  const key = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${key}+Shift+T`);
  await page.waitForTimeout(200);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
