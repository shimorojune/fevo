import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
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
