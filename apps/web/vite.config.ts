import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // sim-core loads its wasm via new URL("sim.wasm", import.meta.url); pre-bundling would break that.
  optimizeDeps: { exclude: ["@fevo/sim-core", "@fevo/sim"] },
  build: { target: "es2022" },
  worker: { format: "es" },
  server: {
    fs: { allow: ["../.."] },
    // apps/api: `pnpm --filter @fevo/api dev`
    proxy: { "/api": process.env.API_URL ?? "http://localhost:8787" },
  },
});
