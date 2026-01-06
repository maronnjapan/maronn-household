import react from "@vitejs/plugin-react";
import vike from "vike/plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vike(), react()],

  // Vikeの環境変数規約: PUBLIC_ENV__ プレフィックスを認識
  envPrefix: "PUBLIC_ENV__",

  build: {
    rollupOptions: {
      external: ["wrangler"],
    },
  },
});
