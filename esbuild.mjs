// Build script: bundles the extension (and, with --tests, the unit tests) with esbuild.
import * as esbuild from 'esbuild';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const args = new Set(process.argv.slice(2));
const production = args.has('--production');
const watch = args.has('--watch');
const tests = args.has('--tests');

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  // jsonc-parser's "main" is a UMD build whose dependencies cannot be bundled statically; prefer ESM.
  mainFields: ['module', 'main'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

if (tests) {
  // Every test/**/*.test.ts becomes out-test/**/*.test.js; the code under test is bundled in.
  const entryPoints = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.test.ts')) entryPoints.push(p);
    }
  };
  walk('test');
  await esbuild.build({
    ...common,
    entryPoints,
    outdir: 'out-test',
    outbase: 'test',
    alias: { vscode: './test/vscodeStub.ts' },
    sourcemap: 'inline',
  });
} else {
  const ctx = await esbuild.context({
    ...common,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    external: ['vscode'],
  });
  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}
