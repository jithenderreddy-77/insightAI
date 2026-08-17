// frontend/e2e/real-browser-bridge.spec.ts
// Stage 2 Real Browser E2E Test Suite using Playwright + Real Chromium + Loaded Manifest V3 Extension

import { test, expect, chromium } from '@playwright/test';
import path from 'path';

test.describe('Stage 2: Real Chromium + Manifest V3 Extension E2E Suite', () => {
  test('Milestone 1: YouTube Real Browser Automation Flow', async () => {
    const extensionPath = path.resolve(__dirname, '../../browser-extension');

    // Launch real Chromium browser with loaded Chrome Companion Extension
    const context = await chromium.launchPersistentContext('', {
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--no-sandbox',
      ],
    });

    const page = await context.newPage();

    // 1. Open real YouTube page in browser
    await page.goto('https://www.youtube.com', { waitUntil: 'domcontentloaded' });
    expect(page.url()).toContain('youtube.com');

    // 2. Locate real search input using perception rules (ARIA / name="search_query")
    const searchInput = page.locator('input[name="search_query"], input[id="search"]');
    await expect(searchInput.first()).toBeVisible({ timeout: 10000 });

    // 3. Execute real text entry & search
    await searchInput.first().fill('quantum computing');
    await searchInput.first().press('Enter');

    // 4. Verify fresh DOM observation (URL changes to results)
    await page.waitForURL(/results\?search_query=quantum/, { timeout: 10000 });
    expect(page.url()).toContain('results?search_query=quantum');

    // 5. Locate and click second video result
    const videoResults = page.locator('ytd-video-renderer a#video-title');
    await expect(videoResults.nth(1)).toBeVisible({ timeout: 10000 });
    await videoResults.nth(1).click();

    // 6. Verify page navigation to video watch URL
    await page.waitForURL(/watch\?v=/, { timeout: 10000 });
    expect(page.url()).toContain('watch?v=');

    // 7. Perform real page scroll
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(500);

    // 8. Execute real browser back navigation
    await page.goBack();
    expect(page.url()).toContain('results?search_query=');

    await context.close();
  });
});
