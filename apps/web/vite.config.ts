import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** Port of `casefile-web` (ADR local-ui-stack §2); `vite` dev proxies `/api` to it. */
const API_PORT = 4321;

export default defineConfig({
  root: "src/client",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src/client", import.meta.url)) } },
  build: { outDir: "../../dist/client", emptyOutDir: true },
  server: { proxy: { "/api": `http://127.0.0.1:${API_PORT}` } },
});
