import { build } from 'esbuild';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [resolve(__dirname, 'src/index.ts')],
  bundle: true,
  outfile: resolve(__dirname, 'dist/index.js'),
  format: 'esm',
  target: 'es2024',
  platform: 'neutral',
  conditions: ['workerd', 'worker', 'browser'],
  mainFields: ['module', 'main'],
  // node_modules解決パスにmcp-server自体のnode_modulesを含める
  nodePaths: [resolve(__dirname, 'node_modules')],
  external: ['node:*', 'cloudflare:*'],
});
