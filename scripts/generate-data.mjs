import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { orderPatchNote } from "./lib/patch-note-json.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentDir = path.join(root, "content");
const dataDir = path.join(root, "data");

function toJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function fromJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJson(relativePath, value) {
  const target = path.join(dataDir, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, toJson(value), "utf8");
}

async function readCollection(relativePath) {
  const dir = path.join(contentDir, relativePath);
  const files = (await readdir(dir)).filter((file) => file.endsWith(".json")).sort();
  return Promise.all(
    files.map(async (file) => ({
      file,
      entry: await fromJson(path.join(dir, file)),
    })),
  );
}

function materializeEntity(entity) {
  const output = {
    ...entity.source,
  };

  if (entity.icon) {
    output.icon = entity.icon;
  }

  if (entity.overrides) {
    for (const [key, value] of Object.entries(entity.overrides)) {
      if (value !== null && value !== undefined) {
        output[key] = value;
      }
    }
  }

  return output;
}

function linkedEntitySlug(entity, entitySlugByRef) {
  if (!entity || typeof entity !== "object") return null;
  const type = entity.type;
  if (typeof type === "string") {
    const selected = entity[type];
    if (typeof selected === "string" && selected) {
      return entitySlugByRef?.[type]?.get(selected) ?? selected;
    }
  }
  if (typeof entity.slug === "string" && entity.slug) return entity.slug;
  return null;
}

function patchToData(patch, entitySlugByRef) {
  const next = { ...patch };
  if ("workshopUrl" in next) {
    next.workshop_url = next.workshopUrl;
    delete next.workshopUrl;
  }
  if (Array.isArray(next.sections)) {
    next.sections = next.sections.map((section) => ({
      ...section,
      entries: Array.isArray(section.entries)
        ? section.entries.map((entry) => {
            const converted = { ...entry };
            if (converted.entity) {
              converted.entity_type = converted.entity.type ?? null;
              converted.entity_slug = linkedEntitySlug(converted.entity, entitySlugByRef);
              delete converted.entity;
            }
            return converted;
          })
        : [],
    }));
  }
  return next;
}

async function main() {
  await Promise.all([
    writeJson("aliases.json", await fromJson(path.join(contentDir, "game/aliases.json"))),
    writeJson("items.json", await fromJson(path.join(contentDir, "game/curated-items.json"))),
    writeJson("game_mode.json", await fromJson(path.join(contentDir, "game/game-mode.json"))),
    writeJson(
      "text_corrections.json",
      await fromJson(path.join(contentDir, "game/text-corrections.json")),
    ),
  ]);

  const entitySlugByRef = {
    unit: new Map(),
    item: new Map(),
    synergy: new Map(),
    relic: new Map(),
    talent: new Map(),
  };

  const units = {};
  for (const { file, entry } of await readCollection("game/units")) {
    entitySlugByRef.unit.set(file.replace(/\.json$/, ""), entry.slug);
    units[entry.name] = {
      id: entry.gameId,
      ...materializeEntity(entry),
    };
  }
  await writeJson("units_full.json", units);

  const itemsFull = {};
  for (const { file, entry } of await readCollection("game/items")) {
    entitySlugByRef.item.set(file.replace(/\.json$/, ""), entry.slug);
    itemsFull[entry.gameId] = materializeEntity(entry);
  }
  await writeJson("items_full.json", itemsFull);

  const synergies = {};
  for (const { file, entry } of await readCollection("game/synergies")) {
    entitySlugByRef.synergy.set(file.replace(/\.json$/, ""), entry.slug);
    synergies[entry.gameId] = materializeEntity(entry);
  }
  await writeJson("synergies.json", synergies);

  const relics = {};
  for (const { file, entry } of await readCollection("game/relics")) {
    entitySlugByRef.relic.set(file.replace(/\.json$/, ""), entry.slug);
    relics[entry.gameId] = materializeEntity(entry);
  }
  await writeJson("relics.json", { relics });

  const talents = {};
  for (const { file, entry } of await readCollection("game/talents")) {
    entitySlugByRef.talent.set(file.replace(/\.json$/, ""), entry.slot);
    const { slot, ...talent } = entry;
    talents[slot] = talent;
  }
  await writeJson("talents.json", talents);

  const abilities = {};
  for (const { entry } of await readCollection("game/abilities")) {
    const { gameId, ...ability } = entry;
    abilities[gameId] = ability;
  }
  await writeJson("abilities.json", abilities);

  const patchEntries = [];
  for (const { file, entry } of await readCollection("patch-notes")) {
    const slug = file.replace(/\.json$/, "");
    const patch = orderPatchNote(patchToData(entry, entitySlugByRef));
    await writeJson(`patch_notes/${file}`, patch);
    patchEntries.push({
      date: patch.date,
      title: patch.title,
      slug,
    });
  }
  patchEntries.sort((a, b) => b.date.localeCompare(a.date) || b.slug.localeCompare(a.slug));
  await writeJson("patch_notes/index.json", { patches: patchEntries });

  console.log(`Generated data from ${patchEntries.length} content patch notes.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
