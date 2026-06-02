import { collection, config, fields } from "@keystatic/core";

const githubRepo = process.env.KEYSTATIC_GITHUB_REPO as
  | `${string}/${string}`
  | undefined;

const storage =
  githubRepo && process.env.NODE_ENV === "production"
    ? ({
        kind: "github",
        repo: githubRepo,
      } as const)
    : ({ kind: "local" } as const);

const entitySchema = {
  gameId: fields.text({ label: "Game ID" }),
  name: fields.slug({ name: { label: "Name" } }),
  slug: fields.text({ label: "Slug" }),
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
  ],
  defaultValue: "change",
});

export default config({
  storage,
  collections: {
    patchNotes: collection({
      label: "Patch Notes",
      path: "../content/patch-notes/*",
      slugField: "title",
      format: { data: "json" },
      columns: ["date", "entitiesSynced"],
      schema: {
        date: fields.date({ label: "Date" }),
        title: fields.slug({ name: { label: "Title" } }),
        source: fields.url({ label: "Source" }),
        workshopUrl: fields.url({ label: "Workshop URL" }),
        flavor: fields.text({ label: "Flavor", multiline: true }),
        entitiesSynced: fields.checkbox({ label: "Entities synced" }),
        entitiesSyncedAt: fields.datetime({ label: "Entities synced at" }),
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
                entity: fields.ignored(),
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
      path: "../content/game/units/*",
      slugField: "name",
      format: { data: "json" },
      columns: ["gameId"],
      schema: entitySchema,
    }),
    items: collection({
      label: "Items",
      path: "../content/game/items/*",
      slugField: "name",
      format: { data: "json" },
      columns: ["gameId"],
      schema: entitySchema,
    }),
    synergies: collection({
      label: "Synergies",
      path: "../content/game/synergies/*",
      slugField: "name",
      format: { data: "json" },
      columns: ["gameId"],
      schema: entitySchema,
    }),
    relics: collection({
      label: "Relics",
      path: "../content/game/relics/*",
      slugField: "name",
      format: { data: "json" },
      columns: ["gameId"],
      schema: entitySchema,
    }),
  },
});
