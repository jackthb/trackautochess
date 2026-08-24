import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Next's PostCSS worker resolves plugins from `web/`, but this repo hoists
// node_modules to the monorepo root. Walk up and pass an absolute path so the
// worker does not have to resolve the bare package name.
function resolveFromAncestors(packageName) {
  const starts = [
    path.dirname(fileURLToPath(import.meta.url)),
    process.cwd(),
  ];

  for (const start of starts) {
    let dir = start;
    for (let i = 0; i < 8; i += 1) {
      const candidate = path.join(dir, "node_modules", ...packageName.split("/"));
      if (fs.existsSync(path.join(candidate, "package.json"))) {
        return createRequire(path.join(candidate, "package.json")).resolve(
          packageName,
        );
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  throw new Error(`Cannot find module '${packageName}'`);
}

const config = {
  plugins: {
    [resolveFromAncestors("@tailwindcss/postcss")]: {},
  },
};

export default config;
