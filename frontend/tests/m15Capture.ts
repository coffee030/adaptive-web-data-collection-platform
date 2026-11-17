import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

export async function captureM15(page: Page, name: string, target?: string) {
  const path = process.env.M15_CAPTURE_DIR;
  if (!path) return;
  await mkdir(path, { recursive: true });
  const destination = join(path, name + '.png');
  if (target) await page.locator(target).screenshot({ path: destination, animations: 'disabled' });
  else await page.screenshot({ path: destination, fullPage: true, animations: 'disabled' });
}

export async function captureM15Zoom(page: Page, name: string) {
  const path = process.env.M15_CAPTURE_DIR;
  if (!path) return;
  await mkdir(path, { recursive: true });
  // Capture the physical viewport. Full-page capture clips native Chromium zoom to CSS pixels.
  const session = await page.context().newCDPSession(page);
  try {
    const { data } = await session.send('Page.captureScreenshot', { captureBeyondViewport: false });
    await writeFile(join(path, name + '.png'), Buffer.from(data, 'base64'));
  } finally { await session.detach(); }
}
