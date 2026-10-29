const esbuild = require("esbuild");
const path = require("node:path");

// Two separate bundles: the voter page stays small, and only the admin page carries the wallet library.
esbuild
  .build({
    entryPoints: {
      app: path.resolve(__dirname, "src", "app.js"),
      admin: path.resolve(__dirname, "src", "admin.js"),
      simple: path.resolve(__dirname, "src", "simple.js"),
    },
    outdir: path.resolve(__dirname, "public"),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    minify: true,
    logLevel: "info",
  })
  .catch(() => process.exit(1));
