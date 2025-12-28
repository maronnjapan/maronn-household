import react from '@vitejs/plugin-react';
import vike from 'vike/plugin';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';

export default defineConfig({
  plugins: [react(), vike()],
  resolve: {
    alias: {
      '#components': fileURLToPath(new URL('./components', import.meta.url)),
      '#hooks': fileURLToPath(new URL('./hooks', import.meta.url)),
      '#lib': fileURLToPath(new URL('./lib', import.meta.url)),
    },
  },
});
