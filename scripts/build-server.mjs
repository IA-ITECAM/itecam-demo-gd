import { build } from 'esbuild';
await build({
  entryPoints: ['server/src/index.ts'],
  outfile: 'dist/server.cjs',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  minify: false,
  sourcemap: false,
  external: ['bufferutil', 'utf-8-validate'],
  logLevel: 'info',
});
