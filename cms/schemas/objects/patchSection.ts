import {defineType, defineField} from 'sanity'

export const patchSection = defineType({
  name: 'patchSection',
  title: 'Patch Section',
  type: 'object',
  fields: [
    defineField({name: 'heading', type: 'string', validation: (r) => r.required()}),
    defineField({
      name: 'entries',
      type: 'array',
      of: [{type: 'patchEntry'}],
    }),
  ],
  preview: {
    select: {heading: 'heading', entries: 'entries'},
    prepare({heading, entries}) {
      const count = Array.isArray(entries) ? entries.length : 0
      return {title: heading || '(no heading)', subtitle: `${count} entries`}
    },
  },
})
