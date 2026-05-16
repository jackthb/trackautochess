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
