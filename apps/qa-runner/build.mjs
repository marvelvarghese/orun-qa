// Bundle the runner (and the workspace TypeScript it imports) into one ESM file.
// Playwright and rrweb stay external: they are resolved from node_modules at run time.
import { build } from "esbuild";

await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/runner.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["playwright", "@rrweb/record"],
  logLevel: "warning",
});
