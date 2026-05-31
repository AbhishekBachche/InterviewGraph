import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

declare const process: { env: Record<string, string | undefined> };

/** Backend origin for the Vite dev proxy (override if API is not on 8003). */
const apiOrigin =
  process.env.VITE_API_ORIGIN?.replace(/\/$/, "") ||
  "http://127.0.0.1:8004";

const frontendPort = (() => {
  const raw = process.env.VITE_DEV_PORT ?? process.env.PORT ?? "5173";
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 5173;
})();

/** Set to `true` or `1` to bind 0.0.0.0 so LAN/ngrok can reach the dev server. */
const devPublic =
  process.env.VITE_DEV_PUBLIC === "1" ||
  process.env.VITE_DEV_PUBLIC === "true";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: frontendPort,
    ...(devPublic ? { host: true } : {}),
    proxy: {
      "/api": { target: apiOrigin, changeOrigin: true, timeout: 0, proxyTimeout: 0 },
      "/t": { target: apiOrigin, changeOrigin: true },
      "/assessment-results": { target: apiOrigin, changeOrigin: true },
    },
  },
});
