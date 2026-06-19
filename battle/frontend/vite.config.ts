import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, proxy API paths to the local FastAPI backend (default :8765).
// In production, nginx proxies these same paths (see nginx.conf.template).
const BACKEND = process.env.VITE_BACKEND_URL || "http://localhost:8765";
const API_PREFIXES = [
  "/api",
  "/images",
  "/rooms",
  "/spells",
  "/quickstart",
  "/saved-characters",
  "/characters-api",
  "/monsters",
  "/runs",
  "/docs",
  "/openapi.json",
];

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 3001,
    proxy: Object.fromEntries(
      API_PREFIXES.map((p) => [p, { target: BACKEND, changeOrigin: true }])
    ),
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
