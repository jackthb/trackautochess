import {defineType, defineField} from 'sanity'

export const talent = defineType({
  name: 'talent',
  title: 'Talent',
  type: 'document',
  fields: [
    defineField({
      name: 'slot',
      title: 'Slot',
      description: 'Slot identifier like 1a, 2b, etc.',
      type: 'string',
      validation: (r) => r.required().regex(/^[1-4][ab]$/),
      readOnly: true,
    }),
    defineField({name: 'title', type: 'string', validation: (r) => r.required()}),
    defineField({name: 'description', type: 'text', rows: 3}),
  ],
  preview: {
    select: {title: 'title', slot: 'slot', desc: 'description'},
    prepare({title, slot, desc}) {
      return {title: `${slot}: ${title}`, subtitle: desc}
    },
  },
})
