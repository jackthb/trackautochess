import { collection, config, fields } from "@keystatic/core";
import React from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

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

const entityReference = fields.relationship({
  label: "Linked entity",
  collection: "entities",
  description:
    "Search all units, items, synergies, relics, and talents by stable lower-case slug, e.g. item:bloodthorn or synergy:naga.",
});

const relatedEntity = fields.object(
  {
    entityKey: entityReference,
    // Legacy type + relationship object. Kept hidden so existing content files
    // still parse; the runtime generator falls back to it when entityKey is not
    // set yet.
    entity: fields.ignored(),
    label: fields.text({ label: "Display label" }),
    description: fields.text({ label: "Description", multiline: true }),
  },
  { label: "Related entity" },
);

const relatedEntities = fields.array(relatedEntity, {
  label: "Related entities",
  itemLabel: (props) => props.fields.label.value || "Related entity",
});

const markdownText = (options: {
  label: string;
  description?: string;
}) => {
  const base = fields.text({
    ...options,
    multiline: true,
  });

  return {
    ...base,
    Input: (props: any) =>
      React.createElement(MarkdownTextInput, {
        ...props,
        label: options.label,
        description: options.description,
      }),
  };
};

function MarkdownTextInput({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  value?: string;
  onChange: (value: string) => void;
}) {
  const text = value ?? "";

  return React.createElement(
    "div",
    {
      style: {
        display: "grid",
        gap: 8,
      },
    },
    React.createElement(
      "div",
      null,
      React.createElement(
        "div",
        {
          style: {
            color: "var(--ksv-color-foreground-neutral)",
            fontSize: 13,
            fontWeight: 600,
          },
        },
        label,
      ),
      description
        ? React.createElement(
            "div",
            {
              style: {
                color: "var(--ksv-color-foreground-neutral-secondary)",
                fontSize: 12,
                lineHeight: 1.4,
                marginTop: 2,
              },
            },
            description,
          )
        : null,
    ),
    React.createElement("textarea", {
      value: text,
      onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) =>
        onChange(event.target.value),
      rows: 10,
      style: {
        background: "var(--ksv-color-background-canvas)",
        border: "1px solid var(--ksv-color-border-neutral)",
        borderRadius: 6,
        color: "var(--ksv-color-foreground-neutral)",
        font: "inherit",
        fontFamily:
          'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
        lineHeight: 1.5,
        minHeight: 180,
        padding: 12,
        resize: "vertical",
        width: "100%",
      },
    }),
    React.createElement(
      "div",
      {
        style: {
          color: "var(--ksv-color-foreground-neutral-secondary)",
          fontSize: 12,
          fontWeight: 600,
        },
      },
      "Preview",
    ),
    React.createElement(
      "div",
      {
        style: {
          background: "var(--ksv-color-background-canvas)",
          border: "1px solid var(--ksv-color-border-neutral)",
          borderRadius: 6,
          color: "var(--ksv-color-foreground-neutral)",
          lineHeight: 1.6,
          minHeight: 120,
          padding: 12,
        },
      },
      text
        ? React.createElement(ReactMarkdown, {
            remarkPlugins: [remarkGfm, remarkBreaks],
            children: text,
          })
        : React.createElement(
            "span",
            {
              style: {
                color: "var(--ksv-color-foreground-neutral-secondary)",
              },
            },
            "Nothing to preview.",
          ),
    ),
  );
}

const createEntitySchema = ({ showTechnicalFields = true } = {}): Record<string, any> => ({
  gameId: showTechnicalFields
    ? fields.text({ label: "Game ID" })
    : fields.ignored(),
  name: fields.slug({ name: { label: "Name" } }),
  slug: fields.text({ label: "Slug" }),
  icon: showTechnicalFields
    ? fields.text({
        label: "Icon path",
        description: "Relative to web/public/icons, for example units/axe.png.",
      })
    : fields.ignored(),
  commentary: markdownText({
    label: "Commentary",
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
                commentary: markdownText({ label: "Commentary" }),
                entityKey: entityReference,
                // Legacy type + relationship object. Kept hidden so existing
                // patch entries still parse until they are re-saved with the
                // single selector.
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
      columns: ["slug"],
      schema: createEntitySchema({ showTechnicalFields: false }),
    }),
    synergies: collection({
      label: "Synergies",
      path: `${contentPath}/game/synergies/*`,
      slugField: "name",
      format: { data: "json" },
      columns: ["slug"],
      schema: createEntitySchema({ showTechnicalFields: false }),
    }),
    relics: collection({
      label: "Relics",
      path: `${contentPath}/game/relics/*`,
      slugField: "name",
      format: { data: "json" },
      columns: ["slug"],
      schema: createEntitySchema({ showTechnicalFields: false }),
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
    entities: collection({
      label: "All Entities",
      path: `${contentPath}/game/entities/*`,
      slugField: "key",
      format: { data: "json" },
      columns: ["type", "slug", "name"],
      schema: {
        key: fields.slug({ name: { label: "Key" } }),
        type: fields.text({ label: "Type" }),
        slug: fields.text({ label: "Slug" }),
        name: fields.text({ label: "Name" }),
      },
    }),
  },
});
