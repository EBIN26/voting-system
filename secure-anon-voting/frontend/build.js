const esbuild = require("esbuild");
const path = require("node:path");

esbuild
  .build({
    entryPoints: [path.resolve(__dirname, "src", "app.js")],
    outfile: path.resolve(__dirname, "public", "app.js"),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    minify: true,
    define: { global: "globalThis", "process.env.NODE_ENV": '"production"' },
    logLevel: "info",
  })
  .catch(() => process.exit(1));
