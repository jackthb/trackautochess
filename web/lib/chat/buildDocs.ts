import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { ContentDoc, ContentDocType } from "@/lib/chat/types";

interface JsonRecord {
  [key: string]: unknown;
}

interface CollectionEntry {
  file: string;
  entry: JsonRecord;
}

function repoContentDir(): string {
  return path.resolve(process.cwd(), "..", "content");
}

async function readJson(filePath: string): Promise<JsonRecord> {
  return JSON.parse(await readFile(filePath, "utf8")) as JsonRecord;
}

async function readCollection(relativePath: string): Promise<CollectionEntry[]> {
  const dir = path.join(repoContentDir(), relativePath);
  const files = (await readdir(dir))
    .filter((file) => file.endsWith(".json"))
    .sort();
  return Promise.all(
    files.map(async (file) => ({
      file,
      entry: await readJson(path.join(dir, file)),
    })),
  );
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0,
    )
    .map((item) => item.trim());
}

function entityUrlPath(docType: ContentDocType, slug: string): string | null {
  switch (docType) {
    case "unit":
      return `/units/${slug}`;
    case "synergy":
      return `/synergies/${slug}`;
    case "item":
      return `/items/${slug}`;
    case "relic":
      return `/relics/${slug}`;
    case "talent":
      return "/talents";
    case "patch":
      return `/patch-notes/${slug}`;
    default:
      return null;
  }
}

function materializeSource(entry: JsonRecord): JsonRecord {
  const source = entry.source;
  if (source && typeof source === "object") {
    return source as JsonRecord;
  }
  return entry;
}

function buildEntityContent(
  docType: ContentDocType,
  name: string,
  source: JsonRecord,
  entry: JsonRecord,
  extraLines: string[] = [],
): string {
  const lines = [`Type: ${docType}`, `Name: ${name}`];

  const description = asString(source.description);
  if (description) lines.push("", "Description:", description);

  const lore = asString(source.lore);
  if (lore) lines.push("", "Lore:", lore);

  const notes = asStringArray(source.notes);
  if (notes.length > 0) {
    lines.push("", "Notes:");
    for (const note of notes) lines.push(`- ${note}`);
  }

  const commentary = asString(entry.commentary);
  if (commentary) lines.push("", "Commentary:", commentary);

  if (docType === "unit") {
    const synergies = asStringArray(source.synergies);
    if (synergies.length > 0) {
      lines.push("", "Synergies:", synergies.join(", "));
    }
    const cost = source.cost;
    if (typeof cost === "number") lines.push(`Cost: $${cost}`);
  }

  if (extraLines.length > 0) {
    lines.push("", ...extraLines);
  }

  return lines.join("\n");
}

function buildSynergyUnitIndex(
  unitEntries: CollectionEntry[],
): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const { entry } of unitEntries) {
    const source = materializeSource(entry);
    const name = asString(entry.name) ?? asString(source.name);
    if (!name) continue;
    for (const synergy of asStringArray(source.synergies)) {
      const list = index.get(synergy) ?? [];
      list.push(name);
      index.set(synergy, list);
    }
  }
  for (const [key, units] of index) {
    index.set(
      key,
      [...new Set(units)].sort((a, b) => a.localeCompare(b)),
    );
  }
  return index;
}

function buildEntityDoc(
  docType: ContentDocType,
  slug: string,
  name: string,
  source: JsonRecord,
  entry: JsonRecord,
  extraLines: string[] = [],
): ContentDoc {
  const content = buildEntityContent(docType, name, source, entry, extraLines);
  return {
    id: `${docType}:${slug}`,
    docType,
    title: name,
    content,
    urlPath: entityUrlPath(docType, slug),
    contentHash: hashContent(content),
  };
}

function buildPatchSectionDoc(
  patchSlug: string,
  patchTitle: string,
  patchDate: string,
  sectionIndex: number,
  heading: string,
  entries: JsonRecord[],
): ContentDoc {
  const lines = [
    `Patch: ${patchTitle}`,
    `Date: ${patchDate}`,
    `Section: ${heading}`,
    "",
  ];

  for (const entry of entries) {
    const kind = asString(entry.kind) ?? "change";
    const name = asString(entry.name) ?? "Change";
    const detail = asString(entry.detail);
    lines.push(`[${kind}] ${name}`);
    if (detail) lines.push(detail);
    const commentary = asString(entry.commentary);
    if (commentary) lines.push(`Commentary: ${commentary}`);
    lines.push("");
  }

  const content = lines.join("\n").trim();
  const title = `${patchTitle} — ${heading}`;
  return {
    id: `patch:${patchSlug}:${sectionIndex}`,
    docType: "patch",
    title,
    content,
    urlPath: entityUrlPath("patch", patchSlug),
    contentHash: hashContent(content),
  };
}

export async function buildContentDocs(): Promise<ContentDoc[]> {
  const unitEntries = await readCollection("game/units");
  const synergyEntries = await readCollection("game/synergies");
  const itemEntries = await readCollection("game/items");
  const relicEntries = await readCollection("game/relics");
  const talentEntries = await readCollection("game/talents");
  const patchEntries = await readCollection("patch-notes");

  const synergyUnits = buildSynergyUnitIndex(unitEntries);
  const docs: ContentDoc[] = [];

  for (const { entry } of unitEntries) {
    const slug = asString(entry.slug);
    const name = asString(entry.name);
    if (!slug || !name) continue;
    docs.push(
      buildEntityDoc("unit", slug, name, materializeSource(entry), entry),
    );
  }

  for (const { entry } of synergyEntries) {
    const slug = asString(entry.slug);
    const name = asString(entry.name);
    if (!slug || !name) continue;
    const units = synergyUnits.get(name) ?? [];
    const extra =
      units.length > 0
        ? [`${name} units: ${units.join(", ")}`]
        : [];
    docs.push(
      buildEntityDoc(
        "synergy",
        slug,
        name,
        materializeSource(entry),
        entry,
        extra,
      ),
    );
  }

  for (const { entry } of itemEntries) {
    const slug = asString(entry.slug);
    const name = asString(entry.name);
    if (!slug || !name) continue;
    docs.push(
      buildEntityDoc("item", slug, name, materializeSource(entry), entry),
    );
  }

  for (const { entry } of relicEntries) {
    const slug = asString(entry.slug);
    const name = asString(entry.name);
    if (!slug || !name) continue;
    docs.push(
      buildEntityDoc("relic", slug, name, materializeSource(entry), entry),
    );
  }

  for (const { entry } of talentEntries) {
    const slot = asString(entry.slot);
    const title = asString(entry.title);
    const description = asString(entry.description);
    if (!slot || !title) continue;
    const content = [
      "Type: talent",
      `Name: ${title}`,
      `Slot: ${slot}`,
      description ? `\nDescription:\n${description}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    docs.push({
      id: `talent:${slot}`,
      docType: "talent",
      title,
      content,
      urlPath: entityUrlPath("talent", slot),
      contentHash: hashContent(content),
    });
  }

  for (const { file, entry } of patchEntries) {
    const patchSlug = file.replace(/\.json$/, "");
    const patchTitle = asString(entry.title) ?? patchSlug;
    const patchDate = asString(entry.date) ?? "";
    const sections = Array.isArray(entry.sections) ? entry.sections : [];
    sections.forEach((section, sectionIndex) => {
      if (!section || typeof section !== "object") return;
      const record = section as JsonRecord;
      const heading = asString(record.heading) ?? `Section ${sectionIndex + 1}`;
      const entries = Array.isArray(record.entries)
        ? record.entries.filter(
            (item): item is JsonRecord =>
              Boolean(item) && typeof item === "object",
          )
        : [];
      if (entries.length === 0) return;
      docs.push(
        buildPatchSectionDoc(
          patchSlug,
          patchTitle,
          patchDate,
          sectionIndex,
          heading,
          entries,
        ),
      );
    });
  }

  return docs.sort((a, b) => a.id.localeCompare(b.id));
}
