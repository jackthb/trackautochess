import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { orderPatchNote } from "./lib/patch-note-json.mjs";

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

const UNIT_STEM_MAP = {
  "Blood Seeker": "bloodseeker",
  Spectres: "spectre",
  DarkSeer: "dark_seer",
};

const SYN_ICON_MAP = {
  "Demon Hunter": "demonhunter",
  Elemental: "element",
  Faceless: "nraqi",
  Pandaren: "pandaman",
};

function unitStem(name) {
  if (UNIT_STEM_MAP[name]) return UNIT_STEM_MAP[name];
  return name.toLowerCase().replace(/ /g, "_").replace(/-/g, "_").replace(/'/g, "");
}

function relicStem(name) {
  return name.toLowerCase().replace(/ /g, "_").replace(/-/g, "_");
}

function synIconName(name) {
  if (SYN_ICON_MAP[name]) return SYN_ICON_MAP[name];
  return name.toLowerCase().replace(/ /g, "");
}

function itemIconStem(gameId, item) {
  const stem = item?.texture || gameId;
  return stem
    .replace(/^item_custom\//, "")
    .replace(/^custom\//, "")
    .replace(/^item_/, "")
    .toLowerCase()
    .replace(/ /g, "_")
    .replace(/-/g, "_");
}

function iconRef(type, stem) {
  const file = `${type}/${stem}.png`;
  return existsSync(path.join(dataDir, "icons", file)) ? file : null;
}

async function writeJson(relativePath, value) {
  const target = path.join(contentDir, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, toJson(value), "utf8");
}

async function existingContent(relativePath) {
  try {
    return await fromJson(path.join(contentDir, relativePath));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function contentEntity(gameId, name, source, icon, existing) {
  const sourceWithoutLegacyIcons = { ...source };
  delete sourceWithoutLegacyIcons.icon;
  delete sourceWithoutLegacyIcons.icon_url;
  delete sourceWithoutLegacyIcons.icon_dimensions;

  const entity = {
    gameId,
    name,
    slug: slugify(name || gameId),
    ...(icon ? { icon } : {}),
    source: sourceWithoutLegacyIcons,
    overrides: existing?.overrides ?? {},
  };

  return entity;
}

function entityReference(type, slug, entityRefBySlug) {
  const entity = {
    type,
  };
  if (type && slug) {
    entity[type] = entityRefBySlug?.[type]?.get(slug) ?? slug;
  }
  if (slug) {
    entity.slug = slug;
  }
  return entity;
}

function sameEntityReference(a, b) {
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if ((a.type ?? null) !== (b.type ?? null)) return false;

  const type = a.type;
  const aTypedRef = type && typeof a[type] === "string" ? a[type] : null;
  const bTypedRef = type && typeof b[type] === "string" ? b[type] : null;
  if (aTypedRef || bTypedRef) return aTypedRef === bTypedRef;

  const aSlug = typeof a.slug === "string" ? a.slug : null;
  const bSlug = typeof b.slug === "string" ? b.slug : null;
  if (aSlug || bSlug) return aSlug === bSlug;

  return true;
}

function patchEntryKey(entry) {
  return [entry?.kind ?? "", entry?.name ?? "", entry?.detail ?? ""].join("\u0000");
}

function existingSectionFor(existingPatch, section, sectionIndex) {
  const sections = existingPatch?.sections;
  if (!Array.isArray(sections)) return null;

  const byIndex = sections[sectionIndex];
  if (byIndex?.heading === section.heading) return byIndex;
  return sections.find((candidate) => candidate?.heading === section.heading) ?? null;
}

function existingEntryFor(existingSection, entry, entryIndex) {
  const entries = existingSection?.entries;
  if (!Array.isArray(entries)) return null;

  const key = patchEntryKey(entry);
  const byIndex = entries[entryIndex];
  if (patchEntryKey(byIndex) === key) return byIndex;
  return entries.find((candidate) => patchEntryKey(candidate) === key) ?? null;
}

function patchToContent(patch, entityRefBySlug, existingPatch = null) {
  const next = { ...patch };
  if ("workshop_url" in next) {
    next.workshopUrl = next.workshop_url;
    delete next.workshop_url;
  }
  if (Array.isArray(next.sections)) {
    next.sections = next.sections.map((section, sectionIndex) => {
      const existingSection = existingSectionFor(existingPatch, section, sectionIndex);
      return {
        ...section,
        entries: Array.isArray(section.entries)
          ? section.entries.map((entry, entryIndex) => {
            const converted = { ...entry };
            if (converted.entity_type || converted.entity_slug) {
              const type = converted.entity_type ?? null;
              const slug = converted.entity_slug ?? null;
              converted.entity = entityReference(type, slug, entityRefBySlug);
              delete converted.entity_type;
              delete converted.entity_slug;
            }
            const existingEntry = existingEntryFor(existingSection, entry, entryIndex);
            if (
              converted.entity &&
              existingEntry?.entity &&
              sameEntityReference(converted.entity, existingEntry.entity)
            ) {
              converted.entity = existingEntry.entity;
            } else if (!converted.entity && existingEntry?.entity) {
              converted.entity = existingEntry.entity;
            }
            return converted;
          })
          : [],
      };
    });
  }
  return orderPatchNote(next);
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

  const entityRefBySlug = {
    unit: new Map(),
    item: new Map(),
    synergy: new Map(),
    relic: new Map(),
    talent: new Map(),
  };

  for (const [name, unit] of Object.entries(units)) {
    const gameId = unit.id ?? slugify(name);
    const relativePath = `game/units/${slugify(name)}.json`;
    entityRefBySlug.unit.set(slugify(name), slugify(name));
    await writeJson(
      relativePath,
      contentEntity(
        gameId,
        name,
        unit,
        iconRef("units", unitStem(name)),
        await existingContent(relativePath),
      ),
    );
  }

  for (const [gameId, item] of Object.entries(itemsFull)) {
    const relativePath = `game/items/${gameId}.json`;
    entityRefBySlug.item.set(slugify(item.name ?? gameId), gameId);
    await writeJson(
      relativePath,
      contentEntity(
        gameId,
        item.name ?? gameId,
        item,
        iconRef("items", itemIconStem(gameId, item)),
        await existingContent(relativePath),
      ),
    );
  }

  for (const [gameId, synergy] of Object.entries(synergies)) {
    const relativePath = `game/synergies/${gameId}.json`;
    entityRefBySlug.synergy.set(slugify(synergy.name ?? gameId), gameId);
    await writeJson(
      relativePath,
      contentEntity(
        gameId,
        synergy.name ?? gameId,
        synergy,
        iconRef("synergies", synIconName(synergy.name ?? gameId)),
        await existingContent(relativePath),
      ),
    );
  }

  for (const [gameId, relic] of Object.entries(relics.relics ?? {})) {
    const relativePath = `game/relics/${gameId}.json`;
    entityRefBySlug.relic.set(slugify(relic.name ?? gameId), gameId);
    await writeJson(
      relativePath,
      contentEntity(
        gameId,
        relic.name ?? gameId,
        relic,
        iconRef("relics", relicStem(relic.name ?? gameId)),
        await existingContent(relativePath),
      ),
    );
  }

  for (const [slot, talent] of Object.entries(talents)) {
    entityRefBySlug.talent.set(slot, slugify(slot));
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
  let importedPatchCount = 0;
  for (const file of patchFiles) {
    const relativePath = `patch-notes/${file}`;
    const existingPatch = await existingContent(relativePath);
    if (existingPatch?.entitiesSynced === true) {
      continue;
    }
    const patch = await fromJson(path.join(patchDir, file));
    await writeJson(
      relativePath,
      patchToContent(patch, entityRefBySlug, existingPatch),
    );
    importedPatchCount += 1;
  }

  console.log(
    `Imported ${importedPatchCount} patch notes and game data to content/. ` +
      `Skipped ${patchFiles.length - importedPatchCount} synced patch note(s).`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
