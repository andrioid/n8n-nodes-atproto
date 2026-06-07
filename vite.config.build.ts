/**
 * Vite build config for the n8n community node package.
 *
 * Bundles all runtime dependencies (@atproto/*) into the output so the
 * published package has zero `dependencies` — required by n8n's
 * verification guidelines. Only `n8n-workflow` is externalized (provided
 * by n8n at runtime).
 *
 * Uses Vite in library mode (already installed via vitest).
 */

import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { cpSync, mkdirSync } from 'node:fs';

export default defineConfig({
  build: {
    lib: {
      entry: {
        'nodes/Atproto/Atproto.node': resolve(__dirname, 'src/nodes/Atproto/Atproto.node.ts'),
        'nodes/Atproto/AtprotoJetstream.trigger': resolve(__dirname, 'src/nodes/Atproto/AtprotoJetstream.trigger.ts'),
        'credentials/AtprotoApi.credentials': resolve(
          __dirname,
          'src/credentials/AtprotoApi.credentials.ts',
        ),
      },
      formats: ['cjs'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: [
        'n8n-workflow',
        // Node.js builtins — provided by the runtime
        /^node:/,
      ],
      output: {
        // Keep shared chunks next to entry points with stable names
        chunkFileNames: '_chunks/[name].js',
        exports: 'named',
      },
    },
    outDir: 'dist',
    sourcemap: true,
    minify: false,
    // Don't clear dist before build — we copy static files first
    emptyOutDir: true,
  },
  plugins: [
    {
      name: 'copy-static-assets',
      writeBundle() {
        // Copy icons and codex JSON files to dist/
        const staticPatterns = [
          { src: 'src/nodes/Atproto/atproto.svg', dest: 'dist/nodes/Atproto/atproto.svg' },
          { src: 'src/nodes/Atproto/zstd_dictionary', dest: 'dist/nodes/Atproto/zstd_dictionary' },
        ];
        for (const { src, dest } of staticPatterns) {
          mkdirSync(resolve(__dirname, dest, '..'), { recursive: true });
          cpSync(resolve(__dirname, src), resolve(__dirname, dest));
        }
      },
    },
  ],
});
