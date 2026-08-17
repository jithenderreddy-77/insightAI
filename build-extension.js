// build-extension.js - Compiles browser-extension TypeScript sources into browser-extension/dist JavaScript files
const esbuild = require('esbuild');
const fs = require('fs-extra');
const path = require('path');

async function buildExtension() {
  const rootDir = path.resolve(__dirname);
  const extensionDir = path.join(rootDir, 'browser-extension');
  const distDir = path.join(extensionDir, 'dist');

  console.log('[BUILD EXTENSION] Compiling Manifest V3 Chrome Extension...');

  // Ensure dist directory exists
  fs.ensureDirSync(distDir);
  fs.ensureDirSync(path.join(distDir, 'background'));
  fs.ensureDirSync(path.join(distDir, 'content'));

  // 1. Copy manifest.json to dist
  const manifestContent = fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf-8');
  fs.writeFileSync(path.join(distDir, 'manifest.json'), manifestContent);

  // 2. Build background service worker
  await esbuild.build({
    entryPoints: [path.join(extensionDir, 'background', 'service-worker.ts')],
    outfile: path.join(distDir, 'background', 'service-worker.js'),
    bundle: true,
    format: 'esm',
    target: 'es2022',
    sourcemap: false,
  });

  // 3. Build content script
  await esbuild.build({
    entryPoints: [path.join(extensionDir, 'content', 'content-script.ts')],
    outfile: path.join(distDir, 'content', 'content-script.js'),
    bundle: true,
    format: 'iife',
    target: 'es2022',
    sourcemap: false,
  });

  console.log('[BUILD EXTENSION] Successfully built extension to browser-extension/dist/');
}

buildExtension().catch((err) => {
  console.error('[BUILD EXTENSION] Build failed:', err);
  process.exit(1);
});
