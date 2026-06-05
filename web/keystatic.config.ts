import { collection, config, fields } from "@keystatic/core";

const githubRepo = "jackthb/dac-tools" as const;
// The storage *kind* must resolve identically in the browser bundle and on the
// server, because the client decides whether to read content from the GitHub
// API (github mode) or from /api/keystatic/tree (local mode). Only NEXT_PUBLIC_*
// vars and NODE_ENV are inlined into the client bundle — the secret vars
// (CLIENT_ID / CLIENT_SECRET / KEYSTATIC_SECRET) are undefined in the browser.
// Gating on them made the client fall back to "local" storage (hitting
// /api/keystatic/tree → 404 → HTML → "Unable to load collection: JSON.parse
// unexpected character") while the server ran in "github" mode. Gate only on
// values present in both environments; the server reads the secrets at runtime
// for the OAuth token exchange.
const useGithubStorage =
  process.env.NODE_ENV === "production" &&
  Boolean(process.env.NEXT_PUBLIC_KEYSTATIC_GITHUB_APP_SLUG);

const storage =
  useGithubStorage
    ? ({
        kind: "github",
        repo: githubRepo,
      } as const)
    : ({ kind: "local" } as const);
const contentPath = useGithubStorage ? "content" : "../content";

const entryKind = fields.select({
  label: "Kind",
  options: [
    { label: "Change", value: "change" },
    { label: "Buff", value: "buff" },
    { label: "Nerf", value: "nerf" },
    { label: "Added", value: "added" },
    { label: "Removed", value: "removed" },
    { label: "Rework", value: "rework" },
    { label: "Fix", value: "fix" },
    { label: "New", value: "new" },
    { label: "Note", value: "note" },
  ],
  defaultValue: "change",
});

const entityType = fields.select({
  label: "Type",
  options: [
    { label: "Unit", value: "unit" },
    { label: "Item", value: "item" },
    { label: "Synergy", value: "synergy" },
    { label: "Relic", value: "relic" },
    { label: "Talent", value: "talent" },
  ],
  defaultValue: "unit",
});

const entityReference = fields.object(
  {
    type: entityType,
    unit: fields.relationship({
      label: "Unit",
      collection: "units",
      description: "Search and select an existing unit.",
    }),
    item: fields.relationship({
      label: "Item",
      collection: "items",
      description: "Search and select an existing item.",
    }),
    synergy: fields.relationship({
      label: "Synergy",
      collection: "synergies",
      description: "Search and select an existing synergy.",
    }),
    relic: fields.relationship({
      label: "Relic",
      collection: "relics",
      description: "Search and select an existing relic.",
    }),
    talent: fields.relationship({
      label: "Talent",
      collection: "talents",
      description: "Search and select an existing talent.",
    }),
    // Legacy manual slug field. Kept hidden so existing content files still
    // parse; runtime generators fall back to it when no picker value exists yet.
    slug: fields.ignored(),
  },
  {
    label: "Linked entity",
    description:
      "Pick the entity type, then use the matching search field below. The generator ignores non-matching picker fields.",
  },
);

const relatedEntity = fields.object(
  {
    entity: entityReference,
    label: fields.text({ label: "Display label" }),
    description: fields.text({ label: "Description", multiline: true }),
  },
  { label: "Related entity" },
);

const relatedEntities = fields.array(relatedEntity, {
  label: "Related entities",
  itemLabel: (props) => props.fields.label.value || "Related entity",
});

const createEntitySchema = () => ({
  gameId: fields.text({ label: "Game ID" }),
  name: fields.slug({ name: { label: "Name" } }),
  slug: fields.text({ label: "Slug" }),
  icon: fields.text({
    label: "Icon path",
    description: "Relative to web/public/icons, for example units/axe.png.",
  }),
  commentary: fields.text({
    label: "Commentary",
    multiline: true,
    description: "Generic editorial notes explaining what this is / what it does.",
  }),
  source: fields.ignored(),
  overrides: fields.object(
    {
      name: fields.text({ label: "Name override" }),
      description: fields.text({ label: "Description override", multiline: true }),
      lore: fields.text({ label: "Lore override", multiline: true }),
      notes: fields.array(fields.text({ label: "Note", multiline: true }), {
        label: "Notes override",
        itemLabel: (props) => props.value || "Note",
      }),
    },
    { label: "Overrides" },
  ),
  relatedEntities,
});

export default config({
  storage,
  collections: {
    patchNotes: collection({
      label: "Patch Notes",
      path: `${contentPath}/patch-notes/*`,
      slugField: "title",
      format: { data: "json" },
      columns: ["date", "entitiesSynced"],
      parseSlugForSort: (slug) => {
        const timestamp = Date.parse(slug.slice(0, 10));
        return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : -timestamp;
      },
      schema: {
        date: fields.date({ label: "Date" }),
        title: fields.slug({ name: { label: "Title" } }),
        source: fields.url({ label: "Source" }),
        workshopUrl: fields.url({ label: "Workshop URL" }),
        flavor: fields.text({ label: "Flavor", multiline: true }),
        entitiesSynced: fields.checkbox({ label: "Entities synced" }),
        entitiesSyncedAt: fields.ignored(),
        titles: fields.ignored(),
        absorbedDates: fields.ignored(),
        sourceEntries: fields.ignored(),
        sections: fields.array(
          fields.object({
            heading: fields.text({ label: "Heading" }),
            entries: fields.array(
              fields.object({
                kind: entryKind,
                name: fields.text({ label: "Name" }),
                detail: fields.text({ label: "Detail", multiline: true }),
                commentary: fields.text({ label: "Commentary", multiline: true }),
                entity: entityReference,
                evidence: fields.ignored(),
              }),
              {
                label: "Entries",
                itemLabel: (props) => props.fields.name.value || props.fields.kind.value,
              },
            ),
          }),
          {
            label: "Sections",
            itemLabel: (props) => props.fields.heading.value || "Section",
          },
        ),
      },
    }),
    units: collection({
      label: "Units",
      path: `${contentPath}/game/units/*`,
      slugField: "name",
      format: { data: "json" },
      columns: ["gameId"],
      schema: createEntitySchema(),
    }),
    items: collection({
      label: "Items",
      path: `${contentPath}/game/items/*`,
      slugField: "name",
      format: { data: "json" },
      // Files are named by gameId, so the title column shows that cryptic id.
      // Surface the readable slug and the icon path so entries are findable.
      columns: ["slug", "gameId", "icon"],
      schema: createEntitySchema(),
    }),
    synergies: collection({
      label: "Synergies",
      path: `${contentPath}/game/synergies/*`,
      slugField: "name",
      format: { data: "json" },
      // Files are named by gameId, so the title column shows that cryptic id.
      // Surface the readable slug and the icon path so entries are findable.
      columns: ["slug", "gameId", "icon"],
      schema: createEntitySchema(),
    }),
    relics: collection({
      label: "Relics",
      path: `${contentPath}/game/relics/*`,
      slugField: "name",
      format: { data: "json" },
      // Files are named by gameId, so the title column shows that cryptic id.
      // Surface the readable slug and the icon path so entries are findable.
      columns: ["slug", "gameId", "icon"],
      schema: createEntitySchema(),
    }),
    talents: collection({
      label: "Talents",
      path: `${contentPath}/game/talents/*`,
      slugField: "slot",
      format: { data: "json" },
      columns: ["title"],
      schema: {
        slot: fields.slug({ name: { label: "Slot" } }),
        title: fields.text({ label: "Name" }),
        description: fields.text({ label: "Description", multiline: true }),
      },
    }),
  },
});
