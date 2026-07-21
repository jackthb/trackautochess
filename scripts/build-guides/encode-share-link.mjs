#!/usr/bin/env node
// Turns a build spec JSON (see builds/*.spec.json) into a real /builds?b=...
// share link, using the exact same encoding as web/app/builds/BuildPlanner.tsx
// (encodeShare). A spec only needs { name, description, snapshots }; id,
// status, and updatedAt are filled in here.
//
// Usage:
//   node scripts/build-guides/encode-share-link.mjs <spec.json>

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = path.join(__dirname, "..", "..", "content", "game");

function makeId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

// The unit/item `slug` field (URL-friendly, hyphenated) is NOT reliably the
// same as its actual icon filename stem (e.g. "skull-basher"'s file is
// basher.png, "aegis-of-immortal"'s is aegis.png) — that mapping only lives
// in each entity's own `icon` field. Build a real slug -> stem lookup from
// content/game instead of guessing via string transforms.
async function buildIconLookup(subdir) {
  const dir = path.join(CONTENT_DIR, subdir);
  const lookup = new Map();
  for (const file of await readdir(dir)) {
    if (!file.endsWith(".json")) continue;
    const data = JSON.parse(await readFile(path.join(dir, file), "utf-8"));
    if (data.slug && data.icon) {
      lookup.set(data.slug, data.icon.replace(/^(units|items)\//, "").replace(/\.png$/, ""));
    }
  }
  return lookup;
}

function unitIconUrl(stem) {
  return `/icons/units/${stem}.png`;
}

function itemIconUrl(stem) {
  return `/icons/items/${stem}.png`;
}

function normalizePiece(piece, unitIcons, itemIcons) {
  return {
    id: makeId("piece"),
    unitSlug: piece.unitSlug,
    name: piece.name,
    iconUrl:
      piece.iconUrl ||
      unitIconUrl(piece.iconStem || unitIcons.get(piece.unitSlug) || piece.unitSlug.replace(/-/g, "_")),
    cost: piece.cost,
    stars: piece.stars,
    x: piece.x,
    y: piece.y,
    items: (piece.items || []).map((item) => ({
      pickId: makeId("item"),
      slug: item.slug,
      name: item.name,
      tier: item.tier,
      iconUrl:
        item.iconUrl ||
        itemIconUrl(item.iconStem || itemIcons.get(item.slug) || item.slug.replace(/-/g, "_")),
    })),
  };
}

function normalizeSnapshot(snap, unitIcons, itemIcons) {
  return {
    id: makeId("snap"),
    label: snap.label,
    round: snap.round,
    focusNote: snap.focusNote || "",
    pieces: (snap.pieces || []).map((piece) => normalizePiece(piece, unitIcons, itemIcons)),
  };
}

function encodeShare(build) {
  const json = JSON.stringify({ build });
  return Buffer.from(json, "utf-8")
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function decodeShareRoundTrip(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  const json = Buffer.from(padded, "base64").toString("utf-8");
  const payload = JSON.parse(json);
  if (!payload.build || !Array.isArray(payload.build.snapshots)) {
    throw new Error("round-trip decode failed shape check");
  }
  return payload.build;
}

async function main() {
  const specPath = process.argv[2];
  if (!specPath) {
    console.error("Usage: node scripts/build-guides/encode-share-link.mjs <spec.json>");
    process.exit(1);
  }
  const spec = JSON.parse(await readFile(specPath, "utf-8"));
  const [unitIcons, itemIcons] = await Promise.all([
    buildIconLookup("units"),
    buildIconLookup("items"),
  ]);

  const build = {
    id: makeId("build"),
    name: spec.name,
    description: spec.description,
    status: "draft",
    updatedAt: new Date().toISOString(),
    snapshots: spec.snapshots.map((snap) => normalizeSnapshot(snap, unitIcons, itemIcons)),
  };

  const encoded = encodeShare(build);
  const roundTrip = decodeShareRoundTrip(encoded);
  if (roundTrip.name !== build.name || roundTrip.snapshots.length !== build.snapshots.length) {
    console.error("Round-trip verification failed — not printing an unverified link.");
    process.exit(1);
  }

  console.log(`/builds?b=${encoded}`);
}

main();
