import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// dev時は go サーバー(:8080)にWS/APIをプロキシする
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/ws": { target: "ws://localhost:8080", ws: true },
      "/api": { target: "http://localhost:8080" },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
