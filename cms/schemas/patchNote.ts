import {defineType, defineField} from 'sanity'

export const patchNote = defineType({
  name: 'patchNote',
  title: 'Patch Note',
  type: 'document',
  fields: [
    defineField({
      name: 'date',
      type: 'date',
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'title',
      title: 'Title (English, canonical key)',
      type: 'string',
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'titles',
      title: 'Localized titles',
      description:
        'Optional per-locale title. When unset for a locale, the site falls back to the English title. Patch notes are not in the VPK; populate via Sanity AI Assist or the editor.',
      type: 'localizedNames',
    }),
    defineField({
      name: 'slug',
      type: 'slug',
      options: {source: (doc) => `${doc.date || ''}-${doc.title || ''}`, maxLength: 96},
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'source',
      title: 'Source URL (Steam changelog, etc.)',
      type: 'url',
    }),
    defineField({
      name: 'flavor',
      title: 'Flavor text (intro paragraph)',
      type: 'text',
      rows: 4,
    }),
    defineField({
      name: 'sections',
      type: 'array',
      of: [{type: 'patchSection'}],
    }),
    defineField({
      name: 'entitiesSynced',
      title: 'Entities synced for this patch',
      description:
        "Whether this patch's game-data changes have been pulled from the VPK into data/*.json and pushed to the CMS. The scraper sets this false on every new patch (and when a hotfix is folded in); the /sync-patch-entities skill (or `node scripts/mark-patch-synced.mjs`) flips it true once the full entity sync has run. Absent on legacy patches predating the flag, which are treated as already synced.",
      type: 'boolean',
      readOnly: true,
    }),
    defineField({
      name: 'entitiesSyncedAt',
      title: 'Entities synced at',
      description: 'Timestamp of the last successful entity sync for this patch.',
      type: 'datetime',
      readOnly: true,
    }),
    defineField({
      name: 'absorbedDates',
      title: 'Absorbed hotfix dates',
      description:
        'Dates of small follow-up "Rebalance Patch" hotfixes that were folded into this patch as Hotfix sections. Tracked so re-scrapes do not recreate them as standalone entries. Clear a date here (and remove its Hotfix section) to split it back out.',
      type: 'array',
      of: [{type: 'string'}],
      readOnly: true,
    }),
  ],
  orderings: [
    {
      title: 'Date (newest first)',
      name: 'dateDesc',
      by: [{field: 'date', direction: 'desc'}],
    },
  ],
  preview: {
    select: {title: 'title', date: 'date'},
    prepare({title, date}) {
      return {title: title || '(untitled)', subtitle: date || ''}
    },
  },
})
