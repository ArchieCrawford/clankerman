import { defineConfig } from "vitest/config";

// Separate from vite.config.ts on purpose: the app build roots at web/, while
// tests live at the repo root and cover src/, web/, and test/.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
