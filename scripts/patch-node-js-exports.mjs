/**
 * Patch dependencies that use the `.node.js` suffix for platform-specific
 * conditional exports (e.g. `uint8arrays`).
 *
 * n8n's custom node loader globs `**\/*.node.js` and tries to load every
 * match as an n8n node class. Platform-specific `.node.js` files from
 * transitive dependencies crash the loader.
 *
 * This script rewrites the `"node"` condition in each package's exports
 * map to point at the standard `"import"` target (functionally identical
 * — just uses Uint8Array instead of Buffer), then deletes the `.node.js`
 * files so the glob can't find them.
 *
 * Runs as `postinstall`.
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const targets = ['node_modules/uint8arrays'];

let removed = 0;

for (const rel of targets) {
  const pkgDir = resolve(root, rel);
  const pkgPath = join(pkgDir, 'package.json');
  if (!existsSync(pkgPath)) continue;

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (!pkg.exports) continue;

  let patched = false;

  // Patch both "exports" and "imports" (subpath imports use #prefix)
  for (const field of [pkg.exports, pkg.imports]) {
    if (!field || typeof field !== 'object') continue;
    for (const conditions of Object.values(field)) {
      if (typeof conditions !== 'object' || conditions === null) continue;
      const nodeEntry = conditions['node'];
      if (typeof nodeEntry !== 'string' || !nodeEntry.endsWith('.node.js')) continue;

      const fallback = conditions['import'] || conditions['module-sync'];
      if (!fallback) continue;

      // Redirect "node" condition to the standard ESM file
      conditions['node'] = fallback;
      patched = true;

      // Delete the .node.js file (and its source map)
      for (const suffix of ['', '.map']) {
        const filePath = join(pkgDir, nodeEntry + suffix);
        try { unlinkSync(filePath); removed++; } catch {}
      }
    }
  }

  if (patched) {
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  }
}

if (removed > 0) {
  console.log(`postinstall: patched ${removed} .node.js exports in node_modules`);
}
