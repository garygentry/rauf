import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import ports from "../../config/ports.json";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: ".",
  publicDir: "public",
  build: {
    outDir: "build",
    emptyOutDir: true,
  },
  server: {
    port: ports.vitePort,
    proxy: {
      "/api": {
        target: `http://${ports.serverHost}:${ports.serverPort}`,
        changeOrigin: false,
      },
    },
  },
});
