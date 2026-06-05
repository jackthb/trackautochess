import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentDir = path.join(root, "content");
const outputFile = path.join(root, "web", "generated", "content-data.ts");

async function fromJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
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

function patchToRuntime(patch, entitySlugByRef) {
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

function exportJson(name, value) {
  return `export const ${name}: unknown = JSON.parse(${JSON.stringify(
    JSON.stringify(value),
  )});\n`;
}

async function main() {
  const aliases = await fromJson(path.join(contentDir, "game", "aliases.json"));
  const itemsSimple = await fromJson(path.join(contentDir, "game", "curated-items.json"));
  const itemLinks = await fromJson(path.join(contentDir, "game", "item-links.json"));

  const entitySlugByRef = {
    unit: new Map(),
    item: new Map(),
    synergy: new Map(),
    relic: new Map(),
    talent: new Map(),
  };

  const unitsFull = {};
  for (const { file, entry } of await readCollection("game/units")) {
    entitySlugByRef.unit.set(file.replace(/\.json$/, ""), entry.slug);
    unitsFull[entry.name] = {
      id: entry.gameId,
      ...materializeEntity(entry),
    };
  }

  const itemsFull = {};
  for (const { file, entry } of await readCollection("game/items")) {
    entitySlugByRef.item.set(file.replace(/\.json$/, ""), entry.slug);
    itemsFull[entry.gameId] = materializeEntity(entry);
  }

  const synergies = {};
  for (const { file, entry } of await readCollection("game/synergies")) {
    entitySlugByRef.synergy.set(file.replace(/\.json$/, ""), entry.slug);
    synergies[entry.gameId] = materializeEntity(entry);
  }

  const relics = {};
  for (const { file, entry } of await readCollection("game/relics")) {
    entitySlugByRef.relic.set(file.replace(/\.json$/, ""), entry.slug);
    relics[entry.gameId] = materializeEntity(entry);
  }

  const talents = {};
  for (const { file, entry } of await readCollection("game/talents")) {
    entitySlugByRef.talent.set(file.replace(/\.json$/, ""), entry.slot);
    const { slot, ...talent } = entry;
    talents[slot] = talent;
  }

  const abilities = {};
  for (const { entry } of await readCollection("game/abilities")) {
    const { gameId, ...ability } = entry;
    abilities[gameId] = ability;
  }

  const patches = {};
  const patchEntries = [];
  for (const { file, entry } of await readCollection("patch-notes")) {
    const slug = file.replace(/\.json$/, "");
    const patch = patchToRuntime(entry, entitySlugByRef);
    patches[slug] = patch;
    patchEntries.push({
      date: patch.date,
      title: patch.title,
      slug,
      ...(patch.titles ? { titles: patch.titles } : {}),
    });
  }
  patchEntries.sort((a, b) => b.date.localeCompare(a.date) || b.slug.localeCompare(a.slug));

  const text = [
    "/* This file is generated from content/. Do not edit by hand. */\n",
    exportJson("aliasesData", aliases),
    exportJson("itemsSimpleData", itemsSimple),
    exportJson("itemLinksData", itemLinks),
    exportJson("unitsFullData", unitsFull),
    exportJson("itemsFullData", itemsFull),
    exportJson("synergiesData", synergies),
    exportJson("relicsData", { relics }),
    exportJson("talentsData", talents),
    exportJson("abilitiesData", abilities),
    exportJson("patchIndexData", { patches: patchEntries }),
    exportJson("patchesBySlugData", patches),
  ].join("");

  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, text, "utf8");
  console.log(`Generated web runtime data from content: ${path.relative(root, outputFile)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
