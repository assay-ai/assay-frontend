import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

/**
 * The frontend's first test infrastructure.
 *
 * `environment: "node"` is deliberate, not a default left unattended: what's
 * under test is a transaction-building function — pure, no DOM, no React.
 * Setting up jsdom for it would be paying for something it never uses. A test
 * that later needs the DOM can opt in with `// @vitest-environment jsdom` at
 * the top of its file.
 */
/*
  Dates in copy are printed in the reader's zone; tests read them in UTC so
  they do not depend on the machine they run on.
*/
process.env.TZ = "UTC";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
