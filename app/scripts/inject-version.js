#!/usr/bin/env node
/**
 * Injects version from package.json into theme extension files
 * Run this before deploying to Shopify
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version from package.json
const packageJsonPath = join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
const version = packageJson.version;

console.log(`[Version Inject] Injecting version ${version} into theme extension...`);

// Update Liquid template
const liquidPath = join(__dirname, '..', 'extensions', 'see-it-extension', 'blocks', 'see-it-button.liquid');
let liquidContent = readFileSync(liquidPath, 'utf-8');

// Replace version badge (handle both formats)
liquidContent = liquidContent.replace(
    /<div class="see-it-version-badge">See It v[\d.]+<\/div>/,
    `<div class="see-it-version-badge">See It v${version}</div>`
);

writeFileSync(liquidPath, liquidContent, 'utf-8');
console.log(`[Version Inject] Updated ${liquidPath}`);

// Also update JS VERSION constant (if present)
const jsPath = join(__dirname, '..', 'extensions', 'see-it-extension', 'assets', 'see-it-modal.js');
let jsContent = readFileSync(jsPath, 'utf-8');

// Only update if there's a clear VERSION pattern (avoid accidental replacements)
const versionPattern = /(const|let|var)\s+VERSION\s*=\s*['"][\d.]+['"]/;
if (versionPattern.test(jsContent)) {
    jsContent = jsContent.replace(versionPattern, `const VERSION = '${version}'`);
    writeFileSync(jsPath, jsContent, 'utf-8');
    console.log(`[Version Inject] Updated ${jsPath}`);
}

console.log(`[Version Inject] Complete! Version ${version} injected.`);

