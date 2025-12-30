import type { Config } from "vike/types";
import vikePhoton from "vike-photon/config";
import vikeReact from "vike-react/config";

// Default config (can be overridden by pages)
// https://vike.dev/config

export default {
  // https://vike.dev/head-tags
  title: "家計簿アプリ",
  description: "シンプルで使いやすい家計簿アプリケーションです。",

  extends: [vikeReact, vikePhoton],

  // https://vike.dev/vike-photon
  photon: {
    server: "../server/entry.ts",
  },
  redirects: {
    // Internal
    '/': '/household',
  }
} satisfies Config;
