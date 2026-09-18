import react from "@vitejs/plugin-react"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

/*
 * Component tests, kept in a second project.
 *
 * The suite over pure functions (vitest.config.ts) runs in node and needs
 * neither jsdom nor the react plugin; loading both for it would slow the eighty
 * cases that only ever call a function. These three do mount a tree, which is
 * the only way to see the thing they are actually about: what a card draws, and
 * where focus lands.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.tsx"],
    environment: "jsdom",
  },
})
