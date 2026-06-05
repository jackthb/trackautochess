import { spawnSync } from "node:child_process";

const watchedPaths = [
  ".",
  "../content/",
  "../data/icons/",
  "../scripts/generate-web-runtime-data.mjs",
];

function git(args) {
  const result = spawnSync("git", args, { stdio: "ignore" });
  return result.status ?? 1;
}

if (git(["rev-parse", "--is-inside-work-tree"]) !== 0) {
  process.exit(1);
}

if (git(["rev-parse", "HEAD^"]) !== 0) {
  process.exit(1);
}

const diffStatus = git([
  "diff",
  "--quiet",
  "HEAD^",
  "HEAD",
  "--",
  ...watchedPaths,
]);

process.exit(diffStatus === 0 ? 0 : 1);
