#!/usr/bin/env node
// Turns a build spec JSON (see builds/*.spec.json) into a real /builds?b=...
// share link, using the exact same encoding as web/app/builds/BuildPlanner.tsx
// (encodeShare). A spec only needs { name, description, snapshots }; id,
// status, and updatedAt are filled in here.
//
// Usage:
//   node scripts/build-guides/encode-share-link.mjs <spec.json>

import { readFile } from "node:fs/promises";

function makeId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function unitIconUrl(stem) {
  return `/icons/units/${stem}.png`;
}

function itemIconUrl(stem) {
  return `/icons/items/${stem}.png`;
}

function normalizePiece(piece) {
  return {
    id: makeId("piece"),
    unitSlug: piece.unitSlug,
    name: piece.name,
    iconUrl: piece.iconUrl || unitIconUrl(piece.iconStem || piece.unitSlug.replace(/-/g, "_")),
    cost: piece.cost,
    stars: piece.stars,
    x: piece.x,
    y: piece.y,
    items: (piece.items || []).map((item) => ({
      pickId: makeId("item"),
      slug: item.slug,
      name: item.name,
      tier: item.tier,
      iconUrl: item.iconUrl || itemIconUrl(item.iconStem || item.slug),
    })),
  };
}

function normalizeSnapshot(snap) {
  return {
    id: makeId("snap"),
    label: snap.label,
    round: snap.round,
    focusNote: snap.focusNote || "",
    pieces: (snap.pieces || []).map(normalizePiece),
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

  const build = {
    id: makeId("build"),
    name: spec.name,
    description: spec.description,
    status: "draft",
    updatedAt: new Date().toISOString(),
    snapshots: spec.snapshots.map(normalizeSnapshot),
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
