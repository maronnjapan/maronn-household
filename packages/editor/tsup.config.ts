import { defineConfig } from 'tsup';
import { copyFileSync } from 'node:fs';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  // dts: false, // 型定義は手動で作成
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['react', 'react-dom'],
  treeshake: true,
  splitting: false,
  minify: false,
  tsconfig: 'tsconfig.json',
  // onSuccess: async () => {
  //   // 型定義ファイルをdistにコピー
  //   copyFileSync('src/index.d.ts', 'dist/index.d.ts');
  // },
});
