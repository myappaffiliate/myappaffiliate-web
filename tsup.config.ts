import { defineConfig } from "tsup";

export default defineConfig([
  // The package consumers `import` — ESM + CJS + one set of .d.ts.
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    target: "es2022",
  },
  // The script-tag bundle. No build tooling on the customer's side, so it has
  // to be one self-contained file and target what a landing page's visitors
  // actually run — not what our toolchain compiles to.
  {
    entry: { sdk: "src/global.ts" },
    format: ["iife"],
    sourcemap: true,
    minify: true,
    target: "es2018",
    platform: "browser",
    outExtension: () => ({ js: ".js" }),
  },
]);
