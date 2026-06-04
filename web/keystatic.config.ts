import { collection, config, fields } from "@keystatic/core";

const githubRepo = "jackthb/dac-tools" as const;
const useGithubStorage = Boolean(
  process.env.NEXT_PUBLIC_KEYSTATIC_GITHUB_APP_SLUG &&
    process.env.KEYSTATIC_GITHUB_CLIENT_ID &&
    process.env.KEYSTATIC_GITHUB_CLIENT_SECRET &&
    process.env.KEYSTATIC_SECRET &&
    process.env.NODE_ENV === "production",
);

const storage =
  useGithubStorage
    ? ({
        kind: "github",
        repo: githubRepo,
      } as const)
    : ({ kind: "local" } as const);
const contentPath = useGithubStorage ? "content" : "../content";

const entitySchema = {
  gameId: fields.text({ label: "Game ID" }),
  name: fields.slug({ name: { label: "Name" } }),
  slug: fields.text({ label: "Slug" }),
  icon: fields.text({
    label: "Icon path",
    description: "Relative to web/public/icons, for example units/axe.png.",
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
};

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
    // parse; scripts/generate-data.mjs falls back to it when no picker value
    // exists yet.
    slug: fields.ignored(),
  },
  {
    label: "Linked entity",
    description:
      "Pick the entity type, then use the matching search field below. The generator ignores non-matching picker fields.",
  },
);

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
      schema: entitySchema,
    }),
    items: collection({
      label: "Items",
      path: `${contentPath}/game/items/*`,
      slugField: "name",
      format: { data: "json" },
      columns: ["gameId"],
      schema: entitySchema,
    }),
    synergies: collection({
      label: "Synergies",
      path: `${contentPath}/game/synergies/*`,
      slugField: "name",
      format: { data: "json" },
      columns: ["gameId"],
      schema: entitySchema,
    }),
    relics: collection({
      label: "Relics",
      path: `${contentPath}/game/relics/*`,
      slugField: "name",
      format: { data: "json" },
      columns: ["gameId"],
      schema: entitySchema,
    }),
    talents: collection({
      label: "Talents",
      path: `${contentPath}/game/talents/*`,
      slugField: "slot",
      format: { data: "json" },
      columns: ["name"],
      schema: {
        slot: fields.slug({ name: { label: "Slot" } }),
        name: fields.text({ label: "Name" }),
        description: fields.text({ label: "Description", multiline: true }),
      },
    }),
  },
});
