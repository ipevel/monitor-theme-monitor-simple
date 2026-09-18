import { defineConfig } from "vitest/config"

// Its own config rather than reusing vite.config.ts: the app config carries the
// react and tailwind plugins, which a test run over pure functions has no use
// for and would only slow down.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
})
