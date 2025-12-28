import react from '@vitejs/plugin-react';
import vike from 'vike/plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), vike()],
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: './tests/setup.ts',
  },
});
