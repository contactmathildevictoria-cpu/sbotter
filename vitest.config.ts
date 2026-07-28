import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirrors the single alias in tsconfig.json ("@/*" -> "./src/*"). Done by
    // hand rather than via vite-tsconfig-paths — one alias isn't worth another
    // devDependency.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // Only pure modules are under test: the daily-list planner and the contact
    // resolver. No DOM, no Supabase, no mocks.
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
  },
  // NOTE: `server-only` is deliberately NOT aliased. It isn't an installed
  // package — Next resolves it internally — so importing it fails outright
  // under Vitest. That's the guard we want: if a module that's supposed to be
  // pure ever grows a server-side dependency, `npm test` breaks loudly instead
  // of the purity rule rotting in silence.
});
