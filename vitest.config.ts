import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

// Its own config rather than reusing vite.config.ts: the app config carries the
// react and tailwind plugins, which a test run over pure functions has no use
// for and would only slow down.
//
// The `@` alias is declared here as well. Without it a test written the way
// every other file in this repo imports -- `@/lib/...` -- fails to resolve and
// the suite reports "cannot find package" rather than anything about the code.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
})
