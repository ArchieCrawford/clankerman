import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  base: "./",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "es2022",
  },
  server: {
    port: 5173,
    host: "127.0.0.1",
  },
});
