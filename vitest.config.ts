import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Miniflare（ローカル D1）を使うテストは worker_threads では不安定なので、ファイルごとにプロセスを分ける
    pool: 'forks',
    // Miniflare の起動とマイグレーションの適用に時間がかかるため
    testTimeout: 30_000,
    hookTimeout: 60_000,
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
  },
});
