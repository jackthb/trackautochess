import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data");
const contentDir = path.join(root, "content");

function fromJson(file) {
  return readFile(file, "utf8").then((text) => JSON.parse(text));
}

function toJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function writeJson(relativePath, value) {
  const target = path.join(contentDir, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, toJson(value), "utf8");
}

function contentEntity(gameId, name, source) {
  const sourceWithoutLegacyIcons = { ...source };
  delete sourceWithoutLegacyIcons.icon_url;
  delete sourceWithoutLegacyIcons.icon_dimensions;

  const entity = {
    gameId,
    name,
    slug: slugify(name || gameId),
    source: sourceWithoutLegacyIcons,
    overrides: {},
  };

  return entity;
}

function patchToContent(patch) {
  const next = { ...patch };
  if ("workshop_url" in next) {
    next.workshopUrl = next.workshop_url;
    delete next.workshop_url;
  }
  if (Array.isArray(next.sections)) {
    next.sections = next.sections.map((section) => ({
      ...section,
      entries: Array.isArray(section.entries)
        ? section.entries.map((entry) => {
            const converted = { ...entry };
            if (converted.entity_type || converted.entity_slug) {
              converted.entity = {
                type: converted.entity_type ?? null,
                slug: converted.entity_slug ?? null,
              };
              delete converted.entity_type;
              delete converted.entity_slug;
            }
            return converted;
          })
        : [],
    }));
  }
  return next;
}

async function main() {
  const [
    aliases,
    curatedItems,
    gameMode,
    textCorrections,
    units,
    itemsFull,
    synergies,
    relics,
    talents,
    abilities,
  ] = await Promise.all([
    fromJson(path.join(dataDir, "aliases.json")),
    fromJson(path.join(dataDir, "items.json")),
    fromJson(path.join(dataDir, "game_mode.json")),
    fromJson(path.join(dataDir, "text_corrections.json")),
    fromJson(path.join(dataDir, "units_full.json")),
    fromJson(path.join(dataDir, "items_full.json")),
    fromJson(path.join(dataDir, "synergies.json")),
    fromJson(path.join(dataDir, "relics.json")),
    fromJson(path.join(dataDir, "talents.json")),
    fromJson(path.join(dataDir, "abilities.json")),
  ]);

  await writeJson("game/aliases.json", aliases);
  await writeJson("game/curated-items.json", curatedItems);
  await writeJson("game/game-mode.json", gameMode);
  await writeJson("game/text-corrections.json", textCorrections);

  for (const [name, unit] of Object.entries(units)) {
    const gameId = unit.id ?? slugify(name);
    await writeJson(
      `game/units/${slugify(name)}.json`,
      contentEntity(gameId, name, unit),
    );
  }

  for (const [gameId, item] of Object.entries(itemsFull)) {
    await writeJson(
      `game/items/${gameId}.json`,
      contentEntity(gameId, item.name ?? gameId, item),
    );
  }

  for (const [gameId, synergy] of Object.entries(synergies)) {
    await writeJson(
      `game/synergies/${gameId}.json`,
      contentEntity(gameId, synergy.name ?? gameId, synergy),
    );
  }

  for (const [gameId, relic] of Object.entries(relics.relics ?? {})) {
    await writeJson(
      `game/relics/${gameId}.json`,
      contentEntity(gameId, relic.name ?? gameId, relic),
    );
  }

  for (const [slot, talent] of Object.entries(talents)) {
    await writeJson(`game/talents/${slugify(slot)}.json`, {
      slot,
      ...talent,
    });
  }

  for (const [gameId, ability] of Object.entries(abilities)) {
    await writeJson(`game/abilities/${gameId}.json`, {
      gameId,
      ...ability,
    });
  }

  const patchDir = path.join(dataDir, "patch_notes");
  const patchFiles = (await readdir(patchDir))
    .filter((file) => file.endsWith(".json") && file !== "index.json")
    .sort();
  for (const file of patchFiles) {
    const patch = await fromJson(path.join(patchDir, file));
    await writeJson(`patch-notes/${file}`, patchToContent(patch));
  }

  console.log(`Imported ${patchFiles.length} patch notes and game data to content/.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
