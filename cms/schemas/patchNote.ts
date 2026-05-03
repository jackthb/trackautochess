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
      type: 'string',
      validation: (r) => r.required(),
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
