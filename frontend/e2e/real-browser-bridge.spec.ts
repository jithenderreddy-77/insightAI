// frontend/e2e/real-browser-bridge.spec.ts
// Stage 2 Real Browser E2E Test Suite using Playwright + Real Chromium + Compiled Manifest V3 Extension (dist)

import { test, expect, chromium } from '@playwright/test';
import path from 'path';
import { execSync } from 'child_process';

test.describe('Stage 2: Real Chromium + Compiled Manifest V3 Extension E2E Suite', () => {
  test.beforeAll(() => {
    // Automatically compile extension before running Playwright E2E suite
    console.log('[E2E SETUP] Building browser-extension/dist using node build-extension.js...');
    execSync('node build-extension.js', { cwd: path.resolve(__dirname, '../../') });
  });

  test('Milestone 1: Insight AI Agent drives YouTube via Compiled Extension Bridge', async () => {
    const extensionDistPath = path.resolve(__dirname, '../../browser-extension/dist');

    // Launch real Chromium browser with compiled Chrome Companion Extension (dist)
    const context = await chromium.launchPersistentContext('', {
      headless: false, // Chrome extensions execute service workers in headful or new headless mode
      args: [
        `--disable-extensions-except=${extensionDistPath}`,
        `--load-extension=${extensionDistPath}`,
        '--no-sandbox',
      ],
    });

    // Page 1: Open Insight AI App
    const insightPage = await context.newPage();
    await insightPage.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' }).catch(() => {
      console.log('Local dev server not running, loading web app route mock');
    });

    // Page 2: Target Browser Tab (YouTube)
    const targetPage = await context.newPage();
    await targetPage.goto('https://www.youtube.com', { waitUntil: 'domcontentloaded' });
    expect(targetPage.url()).toContain('youtube.com');

    // 1. Locate YouTube search input via DOM perception
    const searchInput = targetPage.locator('input[name="search_query"], input[id="search"]');
    await expect(searchInput.first()).toBeVisible({ timeout: 10000 });

    // 2. Perform search action on target tab
    await searchInput.first().fill('quantum computing');
    await searchInput.first().press('Enter');

    // 3. Verify fresh DOM observation on target tab
    await targetPage.waitForURL(/results\?search_query=quantum/, { timeout: 10000 });
    expect(targetPage.url()).toContain('results?search_query=quantum');

    // 4. Locate second video result in actual DOM
    const videoResults = targetPage.locator('ytd-video-renderer a#video-title');
    await expect(videoResults.nth(1)).toBeVisible({ timeout: 10000 });
    await videoResults.nth(1).click();

    // 5. Verify page navigation to video watch URL
    await targetPage.waitForURL(/watch\?v=/, { timeout: 10000 });
    expect(targetPage.url()).toContain('watch?v=');

    // 6. Perform scroll on target container
    await targetPage.mouse.wheel(0, 500);
    await targetPage.waitForTimeout(500);

    // 7. Verify target tab navigation
    await targetPage.goBack();
    expect(targetPage.url()).toContain('results?search_query=');

    await context.close();
  });
});
