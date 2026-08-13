import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

const shared = fileURLToPath(new URL("../shared", import.meta.url));

export default defineConfig({
  // Relative assets work both at localhost and under /<repository>/ on GitHub Pages.
  base: "./",
  plugins: [react()],
  resolve: {
    alias: { "@shared": shared },
  },
  server: {
    port: 5191,
    // Fail loudly on a port clash rather than drifting away from the proxy config.
    strictPort: true,
    // The scoring engine lives outside the frontend root so both tiers share it.
    fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] },
    proxy: {
      "/api": { target: "http://127.0.0.1:5190", changeOrigin: true },
    },
  },
});
