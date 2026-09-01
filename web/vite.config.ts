import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages はリポジトリ名のサブパス配下で配信されるため、base を合わせる。
// Actions から VITE_BASE を渡す。ローカル開発や独自ドメインでは "/" のまま。
const base = process.env.VITE_BASE ?? "/";

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    // シナリオJSONをリポジトリ直下の scenarios/ から読むため、親を許可する
    fs: { allow: [".."] },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
