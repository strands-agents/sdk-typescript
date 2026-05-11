/**
 * Build script for the strands-agent WASM component.
 *
 * Steps:
 *   1. esbuild – bundle entry.ts + full SDK into a single ESM file
 *   2. componentize – compile the bundle into a WASM component
 *      targeting the `agent` world (exports strands:agent/api directly)
 *
 * Prerequisites:
 *   - npm install at the workspace root
 *   - @strands-agents/sdk must be built first (npm run build:sdk)
 *
 * Key build flags:
 *   --platform=browser     AWS SDK uses fetch instead of node:http
 *   --define:import.meta.vitest=undefined
 *                          StarlingMonkey throws on unknown import.meta
 *                          properties; the SDK uses import.meta.vitest
 *                          for in-source tests that must be eliminated.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { componentize } from '@chaynabors/componentize-js';

mkdirSync('dist', { recursive: true });

const witDir = resolve(import.meta.dirname, '..', 'wit');

// Plugin: redirect @smithy/eventstream-codec's splitMessage to our patched
// version that strips CRC32 validation (redundant over TLS, fails in WASI).
// Patch: componentize-js hands out views into a WASI buffer that gets reused
// on the next read. The AWS SDK's getChunkedStream processes chunks lazily,
// so by the time it reads the data the buffer may be overwritten. Our patch
// copies each chunk immediately on receipt.
// TODO: file upstream on bytecodealliance/componentize-js
const patchWasiBufferReuse = {
  name: 'patch-wasi-buffer-reuse',
  setup(build) {
    build.onResolve({ filter: /getChunkedStream/ }, (args) => {
      if (args.importer.includes('@smithy/eventstream-serde')) {
        return { path: resolve(import.meta.dirname, 'patches/getChunkedStream.js') };
      }
    });
  },
};

// 1. Bundle: resolve all imports into a single ESM file.
await build({
  entryPoints: ['entry.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  define: { 'import.meta.vitest': 'undefined' },
  external: ['strands:*', 'fs', 'path'],
  outfile: 'dist/bundle.js',
  logLevel: 'info',
  plugins: [patchWasiBufferReuse],
});

// 2. Componentize: compile the bundle into a WASM component.
const source = readFileSync('dist/bundle.js', 'utf-8');
const { component } = await componentize(source, {
  witPath: witDir,
  worldName: 'agent',
});
writeFileSync('dist/strands-agent.wasm', component);

console.log('\n✓ strands-ts-wasm/dist/strands-agent.wasm');
