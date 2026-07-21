import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentDir = path.join(root, "content");
const outputFile = path.join(root, "web", "generated", "content-data.ts");
const entityIndexDir = path.join(contentDir, "game", "entities");

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

function materializeRelatedEntities(relatedEntities, entitySlugByRef) {
  if (!Array.isArray(relatedEntities)) return [];
  return relatedEntities
    .map((relation) => {
      const linkedEntity = normalizeLinkedEntity(
        relation?.entityKey ?? relation?.entity,
        entitySlugByRef,
      );
      const entity_type = linkedEntity?.type ?? null;
      const entity_slug = linkedEntity?.slug ?? null;
      if (!entity_type || !entity_slug) return null;
      return {
        entity_type,
        entity_slug,
        label: relation.label ?? "",
        description: relation.description ?? "",
      };
    })
    .filter(Boolean);
}

function materializeEntity(entity, entitySlugByRef) {
  const output = {
    ...entity.source,
  };

  if (entity.icon) {
    output.icon = entity.icon;
  }

  if (entity.commentary) {
    output.commentary = entity.commentary;
  }

  if (entity.overrides) {
    for (const [key, value] of Object.entries(entity.overrides)) {
      if (value !== null && value !== undefined) {
        output[key] = value;
      }
    }
  }

  const relatedEntities = materializeRelatedEntities(
    entity.relatedEntities,
    entitySlugByRef,
  );
  if (relatedEntities.length > 0) {
    output.relatedEntities = relatedEntities;
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

function normalizeLinkedEntity(entity, entitySlugByRef) {
  if (typeof entity === "string" && entity) {
    const indexedEntity = entitySlugByRef?.entity?.get(entity);
    if (indexedEntity) return indexedEntity;

    const [type, slug] = entity.split(":", 2);
    return type && slug ? { type, slug } : null;
  }
  if (!entity || typeof entity !== "object") return null;
  const type = entity.type;
  const slug = linkedEntitySlug(entity, entitySlugByRef);
  return typeof type === "string" && slug ? { type, slug } : null;
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
            const linkedEntity = normalizeLinkedEntity(
              converted.entityKey ?? converted.entity,
              entitySlugByRef,
            );
            if (linkedEntity) {
              converted.entity_type = linkedEntity.type;
              converted.entity_slug = linkedEntity.slug;
            }
            if (converted.entityKey) {
              delete converted.entityKey;
            }
            if (converted.entity) {
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

function entityRef(type, slug) {
  return `${type}__${slug}`;
}

function entityIndexEntry(type, slug, name) {
  return {
    ref: entityRef(type, slug),
    key: `${type}:${slug}`,
    type,
    slug,
    name,
  };
}

async function writeEntityIndex(entries) {
  await rm(entityIndexDir, { recursive: true, force: true });
  await mkdir(entityIndexDir, { recursive: true });
  await Promise.all(
    entries.map(({ ref, key, type, slug, name }) =>
      writeFile(
        path.join(entityIndexDir, `${ref}.json`),
        `${JSON.stringify({ key, type, slug, name }, null, 2)}\n`,
        "utf8",
      ),
    ),
  );
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
    entity: new Map(),
  };

  const unitEntries = await readCollection("game/units");
  const itemEntries = await readCollection("game/items");
  const synergyEntries = await readCollection("game/synergies");
  const relicEntries = await readCollection("game/relics");
  const talentEntries = await readCollection("game/talents");

  const entityIndexEntries = [];

  for (const { file, entry } of unitEntries) {
    entitySlugByRef.unit.set(file.replace(/\.json$/, ""), entry.slug);
    entityIndexEntries.push(entityIndexEntry("unit", entry.slug, entry.name));
  }
  for (const { file, entry } of itemEntries) {
    entitySlugByRef.item.set(file.replace(/\.json$/, ""), entry.slug);
    entityIndexEntries.push(entityIndexEntry("item", entry.slug, entry.name));
  }
  for (const { file, entry } of synergyEntries) {
    entitySlugByRef.synergy.set(file.replace(/\.json$/, ""), entry.slug);
    entityIndexEntries.push(entityIndexEntry("synergy", entry.slug, entry.name));
  }
  for (const { file, entry } of relicEntries) {
    entitySlugByRef.relic.set(file.replace(/\.json$/, ""), entry.slug);
    entityIndexEntries.push(entityIndexEntry("relic", entry.slug, entry.name));
  }
  for (const { file, entry } of talentEntries) {
    entitySlugByRef.talent.set(file.replace(/\.json$/, ""), entry.slot);
    entityIndexEntries.push(entityIndexEntry("talent", entry.slot, entry.title));
  }

  entityIndexEntries.sort((a, b) => a.key.localeCompare(b.key));
  for (const entry of entityIndexEntries) {
    entitySlugByRef.entity.set(entry.ref, { type: entry.type, slug: entry.slug });
  }
  await writeEntityIndex(entityIndexEntries);

  const unitsFull = {};
  for (const { entry } of unitEntries) {
    unitsFull[entry.name] = {
      id: entry.gameId,
      ...materializeEntity(entry, entitySlugByRef),
    };
  }

  const itemsFull = {};
  for (const { entry } of itemEntries) {
    itemsFull[entry.gameId] = materializeEntity(entry, entitySlugByRef);
  }

  const synergies = {};
  for (const { entry } of synergyEntries) {
    synergies[entry.gameId] = materializeEntity(entry, entitySlugByRef);
  }

  const relics = {};
  for (const { entry } of relicEntries) {
    relics[entry.gameId] = materializeEntity(entry, entitySlugByRef);
  }

  const talents = {};
  for (const { entry } of talentEntries) {
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
      ...(typeof patch.entitiesSynced === "boolean"
        ? { entitiesSynced: patch.entitiesSynced }
        : {}),
      ...(patch.entitiesSyncedAt ? { entitiesSyncedAt: patch.entitiesSyncedAt } : {}),
    });
  }
  patchEntries.sort((a, b) => b.date.localeCompare(a.date) || b.slug.localeCompare(a.slug));

  const guides = {};
  const guideEntries = [];
  for (const { file, entry } of await readCollection("guides")) {
    const slug = file.replace(/\.json$/, "");
    guides[slug] = entry;
    guideEntries.push({ slug, title: entry.title });
  }
  guideEntries.sort((a, b) => a.title.localeCompare(b.title));

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
    exportJson("guideIndexData", { guides: guideEntries }),
    exportJson("guidesBySlugData", guides),
  ].join("");

  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, text, "utf8");
  console.log(`Generated web runtime data from content: ${path.relative(root, outputFile)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
