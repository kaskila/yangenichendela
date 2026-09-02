import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: {
      // Mirror the `@/*` alias from tsconfig.json without pulling in an extra
      // plugin dependency.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
